import {  ExtensionContext, Uri, Webview} from "vscode";

export function getWebViewHtmlContent(context:ExtensionContext, webview: Webview ) {

    const scriptUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, "media", "js", "panel.js"));
    const codiconUri = webview.asWebviewUri(Uri.joinPath(context.extensionUri, 'media', 'codicon.ttf'));

return /*html*/ `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .loader {
            border-top-color: rgb(37 99 235);
            animation: spin 1s linear infinite;
        }
        .history-panel {
            transform: translateX(-100%);
            transition: transform 0.3s ease-in-out;
        }
        .history-panel.open {
            transform: translateX(0);
        }
        .sticky-header {
            position: sticky;
            top: 0;
            z-index: 40;
            background-color: #1e1e1e00;
            padding: 1rem;
            border-bottom: 1px solid #404040;
        }

        @font-face {
            font-family: "codicon";
            font-display: block;
            src: url(${codiconUri}) format("truetype");
        }
        .codicon[class*='codicon-'] {
            font: normal normal normal 16px/1 codicon;
            display: inline-block;
            text-decoration: none;
            text-rendering: auto;
            text-align: center;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            user-select: none;
            -webkit-user-select: none;
            -ms-user-select: none;
        }
        .codicon-eye:before { content: "\\ea70" }
        .codicon-eye-closed:before { content: "\\eae7" }
    </style>
    <link rel="stylesheet" href="https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.css" />
</head>
<body class="bg-[#1e1e1e00] text-[#d4d4d4] font-sans h-screen flex flex-col">

    <script src="https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js"></script>

    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/go.min.js"></script>
    <script src="https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.js"></script>

    <div class="flex-1 overflow-y-auto space-y-1" id="chatContainer">
        <!-- Chat messages will be added here -->
    </div>

    <!-- History Panel -->
    <div id="historyPanel" class="history-panel fixed left-0 top-0 h-full w-80 bg-[#252526] border-r border-[#404040] z-50">
        <div class="p-4 border-b border-[#404040] flex justify-between items-center bg-[#2d2d2d]">
            <div class="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-[#0066AD]" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" />
                </svg>
                <h2 class="text-[#cccccc] text-lg font-semibold">对话记录</h2>
            </div>
            <button id="closeHistoryBtn" class="text-[#858585] hover:text-[#cccccc] transition-colors p-2 hover:bg-[#404040] rounded">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
        <!-- Add search input -->
        <div class="p-4 border-b border-[#404040] bg-[#2d2d2d]">
            <div class="relative">
                <input
                    type="text"
                    id="historySearch"
                    class="w-full px-4 py-2 bg-[#3c3c3c] text-[#cccccc] rounded-lg border border-[#404040]
                           focus:outline-none focus:border-[#0e639c] focus:ring-1 focus:ring-[#0e639c]
                           placeholder-[#858585]"
                    placeholder="搜索对话记录..."
                />
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 absolute right-3 top-2.5 text-[#858585]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>
        </div>
        <div id="historyList" class="overflow-y-auto h-[calc(100%-124px)] p-4 space-y-3">
            <!-- History items will be populated here -->
        </div>
    </div>

    <!-- Error message for Ollama CLI not installed -->
    <div id="ollamaError" class="hidden bg-red-500 text-white p-4 rounded-md mb-4">
      <p class="font-bold">Error: Ollama CLI not installed</p>
      <p>Please install Ollama CLI to use this application. Visit <a href="https://ollama.com/download" class="underline" target="_blank" rel="noopener noreferrer">ollama.com</a> for installation instructions.</p>
    </div>

    <!-- Input Area -->
    <div class="border-t border-[#252526] p-1 bg-[#1e1e1e33]">
        <div class="flex flex-col">
            <div class="flex">
                <button id="includeCurrent" class="pl-2 pr-2 rounded-lg shadow-lg flex gap-2 text-[#7fff] border border-[#4444]">
                    <div id="includeIcon" title="点击关闭文件作为上下文" class="codicon codicon-eye"></div>
                    <div id="includeCloseIcon" title="点击开启文件作为上下文" class="codicon codicon-eye-closed"></div>
                    <div id="includeContext" title=""></div>
                </button>
            </div>
            <textarea
                id="questionInput"
                class="w-full p-2 bg-[#3c3c3c00] text-[#cccccc] rounded border border-[#3c3c3c]
                    focus:outline-none focus:border-[#0e639c] focus:ring-1 focus:ring-[#0e639c]
                    focus:ring-offset-0 focus:ring-offset-[#1e1e1e] placeholder-[#858585]
                    transition-all duration-100"
                placeholder="Type your question here..."
                rows="1"
                style = "resize: none; overflow: hidden;"
            ></textarea>
            <div class="flex">
                <!-- Model Selector -->
                <div class="relative flex items-center justify-center w-56 transform hover:scale-[1.02] transition-transform duration-200">
                    <select
                        id="modelSelector"
                        class="w-full bg-[#0000] text-[#cccccc] rounded-xl border-2 border-[#0000]
                            focus:outline-none focus:ring-1 focus:ring-[#0000] focus:border-[#0000]
                            backdrop-blur-sm shadow-lg appearance-none transition-all duration-200
                            hover:border-[#5e5e5e00]"
                    >
                    </select>
                    <div class="pointer-events-none absolute right-3 top-[50%] transform -translate-y-1/2">
                        <svg class="h-5 w-5 text-[#858585]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>
                <div class="w-full"></div>
                <button id="submitBtn" class="h-fit px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
                    <span id="sendIcon" class="flex items-center gap-2 transform hover:scale-[1.3] transition-transform duration-200">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                        </svg>
                    </span>
                    <span id="stopIcon" class="hidden flex items-center gap-2 transform hover:scale-[1.3] transition-transform duration-200">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd" />
                        </svg>
                    </span>
                </button>
            </div>
        </div>
    </div>

    <script type="text/javascript" src="${scriptUri}"></script>

</body>
</html>

`;
}
