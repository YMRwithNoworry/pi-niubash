# Pi Niubash

让 Pi agent 的 shell 工具统一使用 Niubash。插件将模型的 `bash` 工具、交互 `!` / `!!` 和 RPC bash 路由到 Niubash，并停用独立的 `powershell`、`pwsh`、`cmd` 工具。

## 安装

先安装 Niubash，并确认 `niu --version` 可用。需要 Node.js >=22.19.0 和 `@earendil-works/pi-coding-agent`；已验证 Pi 1.2.0、Windows、Niubash 1.3.3。

```text
pi install npm:@paojiao134/pi-niubash
```

重启 Pi 或运行 `/reload`。模型工具继续使用名称 `bash` 以兼容现有会话和权限插件，标签、说明和模型指令明确显示 Niubash。输入命令时直接写 Niubash 命令，不需要再包 `niu -c`。

插件不捆绑或自动下载 Niubash。找不到 Niubash、启动失败或版本验证不通过时，shell 调用报错，不回退到其他 shell。插件不修改全局 settings.json。

## 指定 Niubash 路径

默认从 Pi 进程的 PATH 查找 `niu.exe`。可以用 CLI 参数指定完整路径：

```text
pi --niubash-path "D:/Tools/Niubash/niu.exe"
```

或在 Niubash 里设置环境变量后启动 Pi：

```bash
export PI_NIUBASH_PATH='D:/Tools/Niubash/niu.exe'
pi
```

优先级：`--niubash-path` > `PI_NIUBASH_PATH` > PATH。路径支持空格和中文。每次扩展加载后，在 session_start 或首次 shell 调用时以 `--version` 验证 Niubash，后续调用复用该执行后端。修复安装或环境变量后运行 `/reload`。

## 执行行为

- 模型的 `bash`、交互 `!` / `!!` 和 RPC bash 使用 `niu -c`，原始命令作为单个参数传入。
- 复用 Pi 原生流式输出、超时、进程树取消、退出状态、输出截断和完整日志。模型工具保留 structuredContent 和 `PI_*` 会话环境变量注入。
- `powershell`、`pwsh`、`cmd` 这些精确工具名称会从 active tools 移除；即使被重新激活或通过 codemode/嵌套工具调用，也会被 tool_call 拦截。
- read/edit/write 等其他工具保持可用。
- Pi 的 `shellCommandPrefix` 仍由 Pi 应用到 `!` / `!!` 和 RPC bash。已有 `shopt` 等 GNU Bash 专用前缀需要移除或改为 Niubash 支持的语法。模型的替换工具不应用该旧前缀。
- 每条命令使用非交互 `-c` 模式，不自动加载交互 rc 文件。Niubash 自己的 `NIU_ENV` / `BASH_ENV` 设置仍按 Niubash 的行为生效。

## 范围与兼容性

此插件限制 Pi 的上述 shell 工具入口，不解析命令文本。命令、脚本或外部程序仍可显式启动其他 shell；这不是操作系统级执行白名单。

其他扩展若同时替换 `bash`，或抢先处理 `user_bash`，可能争用路由。避免同时启用多个 shell replacement 扩展。外部 MCP 执行器、扩展自身的 Node 子进程，以及直接 SDK `session.executeBash()` 调用不属于此插件全面拦截的入口；SDK 调用者应传入相应 operations 或调用扩展工具路径。

本包使用当前 `@earendil-works` Pi API。没有声明旧 `@mariozechner` 包版本兼容性。

## 排查

- **Niubash not found**：确认 Pi 启动时继承的 PATH 包含 niu.exe 所在目录，或配置显式路径。
- **Executable rejected**：所选程序必须是 Niubash，且 `--version` 返回 Niubash 版本行。
- **命令语法不适用**：使用 Niubash 语法和原生 Windows 路径，先检查 `niu --help` 及本机实际支持的命令。
- **路径修复后仍失败**：执行 `/reload` 重新解析并验证。
- **执行后端不是 Niubash**：检查是否存在其他覆盖 bash / user_bash 的扩展。

## 开发与卸载

在 Niubash 内安装依赖和验证，并让 npm scripts 也使用 Niubash：

```bash
npm install --ignore-scripts
npm --script-shell=niu.exe run check
npm --script-shell=niu.exe test
```

测试需要本机安装 Niubash。集成测试使用临时 Pi 配置，不调用付费模型，不修改个人 Pi 配置。

```text
pi remove npm:@paojiao134/pi-niubash
```

源码：[GitHub](https://github.com/YMRwithNoworry/pi-niubash) · MIT License
