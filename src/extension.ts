import * as vscode from 'vscode';
import os from 'os';
import * as utils from './utils';
import { getWebViewHtmlContent } from './chat';
import { ModelResponse, Ollama } from 'ollama';
import { readFileSync } from 'fs';

interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface chattingRecord {
    uguid: string;
    name: string;
    timestamp: string;
    messages: ChatMessage[];
}

async function preloadModel(model: string) {
    try {
        const config = vscode.workspace.getConfiguration('ollama-chat-rain');
        const serverUrl = config.get<string>('serverUrl') || 'http://localhost:11434';

        const ollamaInstance = new Ollama({
            host: serverUrl
        });

        await ollamaInstance.generate({
            model: model,
            prompt: "",
            stream: false,
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Error preloading model: ${error}`);
    }
}

async function getAvaialableModels(ollamaInstance:Ollama): Promise<ModelResponse[]>{
    const availableModels = await ollamaInstance.list();
    return availableModels.models;
}
let webview: vscode.Webview | null = null;
let currentRecord: chattingRecord | undefined = undefined;

interface MessageData{
    command: "loadRecord" | "chatResponse" | "newChat" |
    "ollamaInstallErorr" | "ollamaModelsNotDownloaded" | "sendMessage" |
    "showRecords" | "updateModelList" | "messageStreamEnded" | "error" |
    "updateInclude";
    text?: string;
    availableModels?: string[];
    selectedModel?: string;
    records?: chattingRecord[];
    uguid?: string;
    include?: boolean;
}
function postMessage(data: MessageData) {
    if (webview) {
        webview.postMessage(data);
    }
}
function initCurrentRecord(name: string, context: vscode.ExtensionContext) {
    if (!currentRecord) {
        currentRecord = {
            uguid: utils.getNonce(),
            name: name,
            timestamp: new Date().toLocaleTimeString(),
            messages: []
        };
        currentRecord.messages.push({
            role: "system",
            content: utils.systemPromptContent
        });
        const records = context.workspaceState.get<chattingRecord[]>('ollamaChatRecord', []);
        records.push(currentRecord);
        context.workspaceState.update('ollamaChatRecord', records);
    }
}
function updateCurrentRecord(msg: ChatMessage, context: vscode.ExtensionContext) {
    if (currentRecord) {
        currentRecord.messages.push(msg);
        const records = context.workspaceState.get<chattingRecord[]>('ollamaChatRecord', []);
        const index = records.findIndex(value => value.uguid === currentRecord?.uguid);
        if (index < 0) {
            records.push(currentRecord);
            postMessage({
                command: "loadRecord",
                records: records,
                uguid: currentRecord.uguid
            });
        } else {
            records[index] = currentRecord;
        }
        context.workspaceState.update('ollamaChatRecord', records);
    }
}
function updateInclude() {
    let path = "";
    if (vscode.window.activeTextEditor) {
        path = vscode.window.activeTextEditor.document.uri.fsPath;
    }
    postMessage({
        command: "updateInclude",
        text: path,
        include: globalThis.includeCurrent
    });
}

export function activate(context: vscode.ExtensionContext) {
    globalThis.isRunningOnWindows = os.platform() === 'win32' ? true : false;
    globalThis.selectedModel = undefined;
    globalThis.stopResponse = false;
    globalThis.chatting = false;
    globalThis.includeCurrent = true;

    const config = vscode.workspace.getConfiguration('ollama-chat-rain');
    const serverUrl = config.get<string>('serverUrl') || 'http://localhost:11434';

    if (serverUrl === 'http://localhost:11434') {
        utils.executableIsAvailable("ollama");
    }

    const extensionContext = context;
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('OllamaChat.View', {
        resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
            webview = webviewView.webview;
            webview.options = {
                enableScripts: true,
                localResourceRoots: [extensionContext.extensionUri]
            };
            webview.html = getWebViewHtmlContent(extensionContext, webview);
            
            const ollamaInstance = new Ollama({
                host: serverUrl
            });

            let ollamaInstalled = true;
            if (serverUrl === 'http://localhost:11434') {
                ollamaInstalled = utils.executableIsAvailable("ollama");
                if (ollamaInstalled === false) {
                    webview.postMessage({ command: "ollamaInstallErorr"});
                }
            }

            webview.onDidReceiveMessage(async (message: any) => {

                if (message.command === 'chat') {
                    globalThis.stopResponse = false;
                    let messages: ChatMessage[] = currentRecord ? [...currentRecord.messages] : [];
                    if (messages.length > 10) {
                        messages = messages.slice(messages.length - 10);
                        messages.unshift({
                            role: "system",
                            content: utils.systemPromptContent
                        });
                    }
                    const refers: string[] = [...message.includePaths];
                    initCurrentRecord(message.question, extensionContext);

                    let content = utils.escapeHtml(message.question);
                    if (refers.length > 0) {
                        content += "\n";
                        refers.forEach(path => {
                            let range = "";
                            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath === path) {
                                const start = vscode.window.activeTextEditor.selection.start;
                                const end = vscode.window.activeTextEditor.selection.end;
                                if (start.line !== end.line) {
                                    range += `:${start.line}-${end.line}`;
                                } else if(start.character !== end.character) {
                                    range += `:${start.line}`;
                                }
                            }
                            content += `<a href="file:///${path}" title="${path}">@${utils.getFileName(path)}${range}</a>`;
                        });
                    }
                    updateCurrentRecord({
                        role: 'user',
                        content: content
                    }, extensionContext);

                    postMessage({
                        command: "sendMessage",
                        text: content
                    });

                    globalThis.chatting = true;
                    content = message.question;
                    if (refers.length > 0) {
                        try {
                            content = `user's question:${content}\n\n`;
                            refers.forEach(path => {
                                const editor = vscode.window.activeTextEditor;
                                if (editor && editor.document.uri.fsPath === path) {
                                    const range = editor.selection;
                                    if (range.start.line !== range.end.line || range.start.character !== range.end.character) {
                                        content += `The text selected by the user:${editor.document.getText(editor.selection)}\n\n`;
                                        return;
                                    }
                                }
                                const data = readFileSync(path, { encoding: "utf-8" });
                                content +=`The document path referenced by the user:${path}\ncontent:${data}\n\n`;
                            });
                        } finally { }
                    }
                    messages.push({
                        role: 'user',
                        content: content
                    });
                    try {
                        let responseText = "";
                        const response = await ollamaInstance.chat({
                            model: selectedModel || "",
                            messages: messages,
                            stream: true,
                        });

                        for await (const part of response) {
                            if(globalThis.stopResponse){
                                postMessage({ command: "messageStreamEnded" });
                                response.abort();
                                return;
                            } else {
                                responseText += part.message.content;
                                postMessage({
                                    command: "chatResponse", 
                                    text: responseText,
                                    selectedModel: selectedModel
                                });
                            }
                        }

                        updateCurrentRecord({
                            role: 'assistant',
                            content: responseText
                        }, extensionContext);
                        postMessage({ command: "messageStreamEnded" });
                    } catch (error: any) {
                        if (error.name === 'AbortError') {
                            postMessage({ command: "messageStreamEnded" });
                        } else {
                            postMessage({
                                command: "error", 
                                text: error.message
                            });
                        }
                    } finally {
                        globalThis.chatting = false;
                    }
                } else if (message.command === "stopResponse") {
                    globalThis.stopResponse = true;
                } else if (message.command === "selectRecord" && !globalThis.chatting) {
                    let records = extensionContext.workspaceState.get<chattingRecord[]>('ollamaChatRecord', []);
                    currentRecord = records.find(item => item.uguid === message.uguid);
                    postMessage({
                        command: "loadRecord",
                        records: records,
                        uguid: currentRecord ? currentRecord.uguid : ""
                    });
                } else if (message.command === "deleteRecord" && !globalThis.chatting) {
                    let records = extensionContext.workspaceState.get<chattingRecord[]>('ollamaChatRecord', []);
                    records = records.filter(item =>item.uguid !== message.uguid);
                    await extensionContext.workspaceState.update('ollamaChatRecord', records);
                    if (currentRecord?.uguid === message.uguid) {
                        postMessage({ command: "newChat" });
                        currentRecord = undefined;
                    }
                    let uguid = "";
                    if (currentRecord) {
                        uguid = currentRecord.uguid;
                    } else if (records.length > 0) {
                        uguid = records[records.length - 1].uguid;
                    }
                    postMessage({
                        command: "loadRecord",
                        records: records,
                        uguid: uguid
                    });
                } else if (message.command === "selectedModel") {
                    selectedModel = message.selectedModel;
                } else if (message.command === 'log') {
                    console.log(message.msg);
                } else if (message.command === "pageLoaded") {
                    
                    const records = extensionContext.workspaceState.get<chattingRecord[]>('ollamaChatRecord', []);
                    if (records.length > 0) {
                        currentRecord = records[records.length - 1];
                    }
                    postMessage({
                        command: 'loadRecord',
                        records: records,
                        uguid: currentRecord ? currentRecord.uguid : ""
                    });
                    
                    getAvaialableModels(ollamaInstance).then(availableModelsMeta => {
                        const availableModels = availableModelsMeta.map((model) => model.name);
                        selectedModel = utils.getDefaultModel(availableModels);

                        if (ollamaInstalled && globalThis.selectedModel) {
                            preloadModel(globalThis.selectedModel);
                        }
                        if (!selectedModel) {
                            postMessage({
                                command: "ollamaModelsNotDownloaded",
                                text: "No models available. Please download a model first."
                            });
                            return;
                        }
                        
                        postMessage({
                            command: "updateModelList",
                            availableModels: availableModels,
                            selectedModel: selectedModel
                        });
                    });
                    updateInclude();
                } else if (message.command === "switchIncludeState") {
                    includeCurrent = !includeCurrent;
                    updateInclude();
                }
            });
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand("ollama-chat-rain.ShowRecord", () => {
        postMessage({ command: "showRecords" });
     }));
    context.subscriptions.push(vscode.commands.registerCommand("ollama-chat-rain.NewChat", () => {
        postMessage({ command: "newChat" });
        currentRecord = undefined;
        globalThis.stopResponse = true;

        let records = extensionContext.workspaceState.get<chattingRecord[]>('ollamaChatRecord', []);
        postMessage({
            command: "loadRecord",
            records: records,
            uguid: ""
        });
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(e => updateInclude()));
}

export function deactivate() { }
