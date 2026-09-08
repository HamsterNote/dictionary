---
memory_schema: "1.0"
category: workflow
title: 工作流约束
scope: project
updated_at: 2026-09-06T15:31:00+08:00
---

# 工作流约束

## mem-20260906-avoid-full-build | 避免运行完整 build 脚本

- importance: high
- tags: [build, scripts, workflow]
- created_at: 2026-09-06T15:31:00+08:00
- updated_at: 2026-09-06T15:31:00+08:00
- source: 用户确认的上下文提取

### 内容

本仓库完整 `yarn build` 会先清理输出目录，日常验证不要使用；改用 `yarn build:lib`（vite.lib.config.ts）与 `yarn build:types` 分步验证，回归测试用 `yarn test:dictionary-corrections`（脚本经 Vite 动态构建源码并断言渲染后的 HTML）。Demo 开发服务器端口为 9489。

### 适用条件

适用于本仓库的构建、验证与 Demo 调试流程。

## mem-20260906-git-commit-identity | 提交身份用内联 -c 参数

- importance: normal
- tags: [commit, git, workflow]
- created_at: 2026-09-06T15:31:00+08:00
- updated_at: 2026-09-06T15:31:00+08:00
- source: 用户确认的上下文提取

### 内容

本仓库未配置 git 用户身份；提交时使用内联 `git -c user.name='Z.X' -c user.email='x@z-x.vip'`（与仓库既有作者一致），不修改任何 git 配置文件。

### 适用条件

适用于本仓库的所有 git 提交操作。
