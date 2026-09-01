import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ITEM_TYPES = new Map([
  ["hyperframes:block", "block"],
  ["hyperframes:component", "component"],
  ["hyperframes:example", "example"],
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const safePath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
const httpsUrl = (value) => {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
};

const parseRegistryIndex = (value) => {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("HyperFrames registry index is invalid");
  }
  const names = new Set();
  return value.items
    .map((entry) => {
      if (!isRecord(entry) || !safePath(entry.name) || !ITEM_TYPES.has(entry.type)) {
        throw new Error("HyperFrames registry index contains an invalid item");
      }
      if (names.has(entry.name)) {
        throw new Error(`Duplicate HyperFrames item: ${entry.name}`);
      }
      names.add(entry.name);
      return { name: entry.name, type: entry.type };
    })
    .sort(
      (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name),
    );
};

const parseManifest = (value, expected) => {
  if (
    !isRecord(value) ||
    value.name !== expected.name ||
    value.type !== expected.type ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    !Array.isArray(value.files)
  ) {
    throw new Error(`Invalid HyperFrames manifest: ${expected.name}`);
  }
  const paths = new Set();
  for (const file of value.files) {
    if (
      !isRecord(file) ||
      !safePath(file.path) ||
      typeof file.type !== "string" ||
      (file.target !== undefined && !safePath(file.target))
    ) {
      throw new Error(`Invalid HyperFrames manifest file: ${expected.name}`);
    }
    if (paths.has(file.path)) {
      throw new Error(`Duplicate HyperFrames manifest file: ${file.path}`);
    }
    paths.add(file.path);
  }
  return value;
};

const digestFiles = async (root, paths) => {
  const digest = createHash("sha256");
  for (const path of [...paths].sort()) {
    const bytes = await readFile(join(root, path));
    digest.update(path).update("\0").update(bytes).update("\0");
  }
  return digest.digest("hex");
};

const countVariables = (manifest) => {
  if (Array.isArray(manifest.variables)) return manifest.variables.length;
  if (Array.isArray(manifest.params)) return manifest.params.length;
  return 0;
};

const catalogItem = async (sourceRoot, entry) => {
  const type = ITEM_TYPES.get(entry.type);
  const mirrorPath = `registry/${type}s/${entry.name}`;
  const itemRoot = resolve(sourceRoot, mirrorPath);
  const manifestPath = join(itemRoot, "registry-item.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = parseManifest(JSON.parse(manifestBytes.toString("utf8")), entry);
  const filePaths = ["registry-item.json", ...manifest.files.map((file) => file.path)];
  const rawPreview = isRecord(manifest.preview) ? manifest.preview : {};
  const poster = httpsUrl(rawPreview.poster);
  const video = httpsUrl(rawPreview.video);
  const item = {
    description: manifest.description,
    mirrorPath,
    name: entry.name,
    registryDependencies: Array.isArray(manifest.registryDependencies)
      ? manifest.registryDependencies.filter((dependency) => typeof dependency === "string").sort()
      : [],
    sourceDigest: await digestFiles(itemRoot, filePaths),
    stability: typeof manifest.stability === "string" ? manifest.stability : "unspecified",
    tags: Array.isArray(manifest.tags)
      ? manifest.tags.filter((tag) => typeof tag === "string").sort()
      : [],
    title: manifest.title,
    type,
    variableCount: countVariables(manifest),
  };
  if (
    isRecord(manifest.dimensions) &&
    Number.isFinite(manifest.dimensions.width) &&
    Number.isFinite(manifest.dimensions.height) &&
    manifest.dimensions.width > 0 &&
    manifest.dimensions.height > 0
  ) {
    item.dimensions = {
      height: manifest.dimensions.height,
      width: manifest.dimensions.width,
    };
  }
  if (Number.isFinite(manifest.duration) && manifest.duration > 0) {
    item.duration = manifest.duration;
  }
  if (poster || video)
    item.preview = { ...(poster ? { poster } : {}), ...(video ? { video } : {}) };
  return item;
};

export const buildTemplateCatalog = async ({
  mirrorRepository = "banqingyuan/lynlo-hyperframes-mirror",
  sourceRoot,
  syncedAt,
  upstreamCommit,
}) => {
  if (!/^[a-f0-9]{40}$/.test(upstreamCommit)) {
    throw new Error("upstreamCommit must be a full Git SHA");
  }
  if (!Number.isFinite(Date.parse(syncedAt))) {
    throw new Error("syncedAt must be an ISO timestamp");
  }
  const registryPath = resolve(sourceRoot, "registry/registry.json");
  const registryBytes = await readFile(registryPath);
  const entries = parseRegistryIndex(JSON.parse(registryBytes.toString("utf8")));
  const items = await Promise.all(entries.map((entry) => catalogItem(resolve(sourceRoot), entry)));
  const registryDigest = sha256(registryBytes);
  const catalogDigest = sha256(
    stableJson({
      items: items.map(({ name, sourceDigest, type }) => ({
        name,
        sourceDigest,
        type,
      })),
      registryDigest,
    }),
  );
  return {
    catalogDigest,
    counts: {
      blocks: items.filter((item) => item.type === "block").length,
      components: items.filter((item) => item.type === "component").length,
      examples: items.filter((item) => item.type === "example").length,
      total: items.length,
    },
    items,
    mirror: {
      ref: `upstream-${upstreamCommit}`,
      repository: mirrorRepository,
      syncedAt: new Date(syncedAt).toISOString(),
    },
    registryDigest,
    schemaVersion: 1,
    source: "hyperframes-official-registry",
    upstream: {
      branch: "main",
      commit: upstreamCommit,
      repository: "heygen-com/hyperframes",
    },
  };
};

export const writeTemplateCatalog = async (outputPath, catalog) => {
  const destination = resolve(outputPath);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, stableJson(catalog));
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
  const { values } = parseArgs({
    options: {
      "mirror-repository": { type: "string" },
      output: { type: "string" },
      "source-root": { type: "string" },
      "synced-at": { type: "string" },
      "upstream-commit": { type: "string" },
    },
    strict: true,
  });
  if (!values.output || !values["source-root"] || !values["upstream-commit"]) {
    throw new Error("--output, --source-root and --upstream-commit are required");
  }
  const catalog = await buildTemplateCatalog({
    mirrorRepository: values["mirror-repository"],
    sourceRoot: values["source-root"],
    syncedAt: values["synced-at"] ?? new Date().toISOString(),
    upstreamCommit: values["upstream-commit"],
  });
  await writeTemplateCatalog(values.output, catalog);
  process.stdout.write(
    `${stableJson({ catalogDigest: catalog.catalogDigest, counts: catalog.counts })}`,
  );
}
