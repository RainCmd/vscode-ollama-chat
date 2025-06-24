import * as vscode from 'vscode';
import os from 'os';
import * as utils from './utils';
import { getWebViewHtmlContent } from './chat';
import { ModelResponse, Ollama } from 'ollama';
import * as fs from 'fs';
import * as path from 'path';

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
    "setCurrentInclude" | "updateInclude";
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
function getSelectRange() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        const start = editor.selection.start;
        const end = editor.selection.end;
        if (start.line !== end.line) {
            return `:${start.line}-${end.line}`;
        } else if(start.character !== end.character) {
            return `:${start.line}`;
        }
    }
    return "";
}
function updateCurrentInclude() {
    let path = "";
    if (vscode.window.activeTextEditor) {
        path = vscode.window.activeTextEditor.document.uri.fsPath;
    }
    postMessage({
        command: "setCurrentInclude",
        text: path + getSelectRange(),
        include: globalThis.includeCurrent
    });
}
function collectFiles(dir: string, paths: string[]) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(entry => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectFiles(fullPath, paths);
        } else {
            paths.push(fullPath);
        }
    });
}
function addInclude() {
    if (!vscode.workspace.workspaceFolders) {
        return;
    }
    const items: vscode.QuickPickItem[] = [];

    vscode.workspace.workspaceFolders.forEach(folder => {
        const paths: string[] = [];
        collectFiles(folder.uri.fsPath, paths);
        const length = folder.uri.fsPath.length + 1;
        paths.forEach(value => {
            items.push({
                label: utils.getFileName(value),
                description: value.slice(length),
                detail: value,
                iconPath: new vscode.ThemeIcon("file")
            });
        });
    });
    if (items.length === 0) {
        return;
    }
    vscode.window.showQuickPick(items, { placeHolder: "选择想要引用的文件", matchOnDescription: true }).then(item => {
        postMessage({
            command: "updateInclude",
            text: item?.detail,
        });
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
                    }
                    messages.push({
                        role: "system",
                        content: utils.systemPromptContent
                    });
                    const refers: string[] = message.paths;
                    initCurrentRecord(message.question, extensionContext);

                    let content = utils.escapeHtml(message.question);
                    if (refers.length > 0) {
                        content += "\n";
                        refers.forEach(path => {
                            let range = "";
                            if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath === path) {
                                range = getSelectRange();
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
                                const data = fs.readFileSync(path, { encoding: "utf-8" });
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
                    updateCurrentInclude();
                } else if (message.command === "switchIncludeState") {
                    includeCurrent = !includeCurrent;
                    updateCurrentInclude();
                } else if (message.command === "selectFile") {
                    vscode.workspace.openTextDocument(message.path).then(doc => {
                        vscode.window.showTextDocument(doc, {
                            preview: false,
                            viewColumn: vscode.ViewColumn.One
                        });
                    });
                } else if (message.command === "addInclude") {
                    addInclude();
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
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateCurrentInclude()));
    vscode.window.onDidChangeTextEditorSelection(() => updateCurrentInclude());
}

export function deactivate() { }
