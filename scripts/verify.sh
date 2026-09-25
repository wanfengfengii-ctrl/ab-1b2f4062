#!/bin/sh
# 一次性校验：逻辑校验（单元测试）→ 生产构建 → 页面可访问检查。
# 任一步骤失败即以非零退出码退出；全部通过以 0 退出。
set -e

echo "▶ [1/3] 逻辑校验：剂量引擎单元测试"
npm run test

echo "▶ [2/3] 生产构建"
npm run build

echo "▶ [3/3] 页面可访问检查"
node scripts/check-page.mjs

echo "✔ verify 全部通过"
