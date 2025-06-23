# Ollama Chat

一款 VS Code 扩展程序，让您能够与自托管模型进行离线聊天，这些模型可以从以下链接下载： [ollama](https://ollama.com/download).

## Features

- [x] 与模型聊天
- [ ] 添加文件作为聊天上下文

## How to use ?

1. 安装 [Ollama](https://ollama.com/download) 并下载模型。

    ```bash
    ollama run qwen2.5-coder
    ```

2. 打开终端并运行“ollama serve”命令，或者手动打开 Ollama 应用程序。
3. 在 VSCode 中，通过按下 Cmd+Shift+P（适用于 Mac 系统）或 Ctrl+Shift+P（适用于 Windows 和 Linux 系统）来打开命令面板，然后运行“Ollama Chat”命令。这样就会打开如截图所示的聊天窗口。

## TODO

* [ ] feat:  若用户未手动启动 ollama（通过打开应用程序或使用 `ollama serve` 命令）则会出现错误提示。
* [ ] feat:  如果用户没有相关模型，则显示错误信息。向他们展示安装模型的示例命令。
* [ ] feat:  限制用户在发送消息时使用的令牌数量？
* [ ] feat:  处理 PDF 文件？
* [ ] feat:  音频搜索
* [ ] build: 我们是否需要使用像 Webpack 这样的构建系统呢？
