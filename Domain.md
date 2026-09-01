# Lynlo HyperFrames Mirror

## 职责描述

以只读方式镜像 `heygen-com/hyperframes`，并为 Lynlo 提供可审计的 HyperFrames Registry Catalog。镜像层不生成 ComponentPack，也不参与正式视频生产。

## 项目功能概述与架构设计

仓库以 HyperFrames 上游 `main` 为基础，只增加 Lynlo 自动同步工作流、Catalog 生成器和领域文档。GitHub Actions 先在临时 Worktree 校验完整 Registry，再同步上游内容并发布新的 `catalog/current.json`；失败时远端当前版本不变。上游 CI Workflow 在镜像仓库保持禁用且不参与同步，避免镜像误触上游发布任务。

## 技术栈

- Node.js 22 标准库：Catalog 生成、内容摘要和测试。
- Git 与 GitHub Actions：每 6 小时同步上游并保留历史提交。
- HyperFrames Registry：Block、Component 与 Example 的原始来源。

## 能力清单

- 完整跟随 HyperFrames 上游源码、Registry、Skills 与 Agent 能力。
- 严格校验 Registry 索引、Manifest、声明文件和安全相对路径。
- 生成包含真实预览、变量数量和内容摘要的只读 Catalog。
- 以 `upstream-<commit>` 标签固定每次成功镜像，支持历史模板检出。
- 上游更新不自动生成 Pack，也不修改 Lynlo 生产模板。

## 文件分工与协作

| 文件/子目录                                     | 职责                             | 与其他文件的关系                        |
| ----------------------------------------------- | -------------------------------- | --------------------------------------- |
| `.github/workflows/lynlo-sync-upstream.yml`     | 定时同步、校验、合并和发布       | 调用 Catalog 生成器，成功后直接更新镜像 |
| `scripts/lynlo-build-template-catalog.mjs`      | Registry 校验与 Catalog 生成     | 被工作流和测试复用                      |
| `scripts/lynlo-build-template-catalog.test.mjs` | 新增、修改、删除和失败原子性回归 | 防止自动同步发布不完整目录              |
| `catalog/current.json`                          | 当前只读模板目录                 | 被 Lynlo Dev API 读取                   |
| `registry/`                                     | 上游模板源文件                   | 不允许 Lynlo 原位修改                   |

## 依赖与交互

- **依赖的模块**：`heygen-com/hyperframes/main` 与 GitHub Actions。
- **被依赖情况**：Lynlo Dev API、模板管理页和 Pack 研发 checkout。
- **交互方式**：Git 同步、固定提交/标签、HTTPS Raw Catalog 与模板文件。

## 编译与发布流程

- 测试：`node --test scripts/lynlo-build-template-catalog.test.mjs`。
- 生成：`node scripts/lynlo-build-template-catalog.mjs ...`。
- 发布：定时工作流校验成功后直接推送 `main` 和固定标签；不经过人工批准。
- 上游原有 Bun/TypeScript 构建流程保持不变，镜像同步不执行视频渲染。

## 领域职责评价

模板镜像与 Lynlo Pack/生产合同隔离，避免上游变化进入生产。Git 历史已经提供不可变快照，因此不再复制一套内容寻址 Vendor 目录。

## 开发规范与注意事项

- 上游文件不得做 Lynlo 定制；所有改造进入新的不可变 ComponentPack。
- Catalog 摘要只由 Registry 和模板内容决定，不包含同步时间或 Runtime 版本。
- 同步失败不得推送合并提交、Catalog 或标签。
- 不增加数据库、审批状态机或审美质量门。
- Node.js 版本为 22；本地开发遵循上游 Bun、oxlint 和 oxfmt 规范。

## TODO

- [ ] 当实际同步时长或仓库体积形成瓶颈后，再评估增量归档或对象存储。
