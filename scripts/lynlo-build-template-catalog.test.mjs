import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildTemplateCatalog, writeTemplateCatalog } from "./lynlo-build-template-catalog.mjs";

const SHA = "a".repeat(40);

const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

const makeRegistry = async () => {
  const root = await mkdtemp(join(tmpdir(), "lynlo-hyperframes-catalog-"));
  const registryRoot = join(root, "registry");
  const blockRoot = join(registryRoot, "blocks", "sample");
  await mkdir(blockRoot, { recursive: true });
  await writeJson(join(registryRoot, "registry.json"), {
    items: [{ name: "sample", type: "hyperframes:block" }],
  });
  await writeJson(join(blockRoot, "registry-item.json"), {
    description: "Sample block",
    dimensions: { height: 1920, width: 1080 },
    duration: 3,
    files: [{ path: "sample.html", type: "registry:html" }],
    name: "sample",
    preview: {
      poster: "https://example.com/poster.png",
      video: "https://example.com/preview.mp4",
    },
    tags: ["vertical"],
    title: "Sample",
    type: "hyperframes:block",
    variables: [{ id: "title" }],
  });
  await writeFile(join(blockRoot, "sample.html"), "<main>sample</main>\n");
  return root;
};

const build = (sourceRoot, upstreamCommit = SHA) =>
  buildTemplateCatalog({
    sourceRoot,
    syncedAt: "2026-09-01T00:00:00.000Z",
    upstreamCommit,
  });

test("builds a complete catalog and ignores runtime-only commit changes", async () => {
  const root = await makeRegistry();
  try {
    const first = await build(root);
    const second = await build(root, "b".repeat(40));
    assert.deepEqual(first.counts, {
      blocks: 1,
      components: 0,
      examples: 0,
      total: 1,
    });
    assert.equal(first.items[0].preview.video, "https://example.com/preview.mp4");
    assert.equal(first.items[0].variableCount, 1);
    assert.equal(first.catalogDigest, second.catalogDigest);
    assert.notEqual(first.upstream.commit, second.upstream.commit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("tracks added, changed and deleted templates by content", async () => {
  const root = await makeRegistry();
  try {
    const initial = await build(root);
    const componentRoot = join(root, "registry", "components", "extra");
    await mkdir(componentRoot, { recursive: true });
    await writeJson(join(componentRoot, "registry-item.json"), {
      description: "Extra component",
      files: [{ path: "extra.html", type: "registry:html" }],
      name: "extra",
      title: "Extra",
      type: "hyperframes:component",
    });
    await writeFile(join(componentRoot, "extra.html"), "<span>extra</span>\n");
    await writeJson(join(root, "registry", "registry.json"), {
      items: [
        { name: "sample", type: "hyperframes:block" },
        { name: "extra", type: "hyperframes:component" },
      ],
    });
    const added = await build(root);
    assert.equal(added.counts.total, 2);
    assert.notEqual(added.catalogDigest, initial.catalogDigest);

    await writeFile(
      join(root, "registry", "blocks", "sample", "sample.html"),
      "<main>changed</main>\n",
    );
    const changed = await build(root);
    assert.notEqual(
      changed.items.find((item) => item.name === "sample").sourceDigest,
      initial.items[0].sourceDigest,
    );

    await writeJson(join(root, "registry", "registry.json"), {
      items: [{ name: "sample", type: "hyperframes:block" }],
    });
    const deleted = await build(root);
    assert.equal(deleted.counts.total, 1);
    assert.equal(deleted.items[0].name, "sample");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("rejects missing, unsafe and duplicate upstream records", async () => {
  const root = await makeRegistry();
  try {
    const manifestPath = join(root, "registry", "blocks", "sample", "registry-item.json");
    const original = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeJson(manifestPath, {
      ...original,
      files: [{ path: "missing.html", type: "registry:html" }],
    });
    await assert.rejects(() => build(root), /ENOENT/);

    await writeJson(manifestPath, {
      ...original,
      files: [{ path: "../escape.html", type: "registry:html" }],
    });
    await assert.rejects(() => build(root), /Invalid HyperFrames manifest file/);

    await writeJson(manifestPath, original);
    await writeJson(join(root, "registry", "registry.json"), {
      items: [
        { name: "sample", type: "hyperframes:block" },
        { name: "sample", type: "hyperframes:block" },
      ],
    });
    await assert.rejects(() => build(root), /Duplicate HyperFrames item/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("does not replace the current catalog after a failed build", async () => {
  const root = await makeRegistry();
  const outputRoot = await mkdtemp(join(tmpdir(), "lynlo-current-catalog-"));
  const output = join(outputRoot, "current.json");
  try {
    await writeTemplateCatalog(output, await build(root));
    const before = await readFile(output, "utf8");
    await rm(join(root, "registry", "blocks", "sample", "sample.html"));
    await assert.rejects(async () => {
      await writeTemplateCatalog(output, await build(root));
    });
    assert.equal(await readFile(output, "utf8"), before);
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(outputRoot, { force: true, recursive: true });
  }
});
