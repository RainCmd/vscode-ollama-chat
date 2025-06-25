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
    "setCurrentInclude" | "updateInclude" | "updateContextNumber";
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
function getOllamaChatRecord(context: vscode.ExtensionContext) {
    return context.workspaceState.get<chattingRecord[]>('ollamaChatRecord', []);
}
async function setOllamaChatRecord(context: vscode.ExtensionContext, records: chattingRecord[]) {
    await context.workspaceState.update('ollamaChatRecord', records);
}
function getContextNumber(context: vscode.ExtensionContext) {
    return context.workspaceState.get<number>("contextNumber", 10);
}
function setContextNumber(context: vscode.ExtensionContext, count: number) {
    if (count < 0) {
        count = 0;
    }
    context.workspaceState.update("contextNumber", count);
}
function getIncludeCurrent(context: vscode.ExtensionContext) {
    return context.workspaceState.get<boolean>("includeCurrent", true);
}
async function setIncludeCurrent(context: vscode.ExtensionContext, value: boolean) {
    return context.workspaceState.update("includeCurrent", value);
}
async function initCurrentRecord(name: string, context: vscode.ExtensionContext) {
    if (!currentRecord) {
        currentRecord = {
            uguid: utils.getNonce(),
            name: name,
            timestamp: new Date().toLocaleTimeString(),
            messages: []
        };
        const records = getOllamaChatRecord(context);
        records.push(currentRecord);
        await setOllamaChatRecord(context, records);
    }
}
async function updateCurrentRecord(msg: ChatMessage, context: vscode.ExtensionContext) {
    if (currentRecord) {
        currentRecord.messages.push(msg);
        const records = getOllamaChatRecord(context);
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
        await setOllamaChatRecord(context, records);
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
function updateCurrentInclude(context: vscode.ExtensionContext) {
    let path = "";
    if (vscode.window.activeTextEditor) {
        path = vscode.window.activeTextEditor.document.uri.fsPath;
    }
    postMessage({
        command: "setCurrentInclude",
        text: path + getSelectRange(),
        include: getIncludeCurrent(context)
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
                iconPath: new vscode.ThemeIcon("file"),
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
function showSetContextNumber(context: vscode.ExtensionContext) {
    vscode.window.showInputBox({
        title: "AI回答问题时联系的上下文条数",
        value: getContextNumber(context).toString(),
        prompt: "较少的上下文条目可以让AI更快地做出回应"
    }).then(value => {
        if (value) {
            const intNum: number = parseInt(value);
            if (!isNaN(intNum)) {
                setContextNumber(context, intNum);
                postMessage({
                    command: "updateContextNumber",
                    text: value,
                });
            }
        }
    });
}
export function activate(context: vscode.ExtensionContext) {
    globalThis.isRunningOnWindows = os.platform() === 'win32' ? true : false;
    globalThis.selectedModel = undefined;
    globalThis.stopResponse = false;
    globalThis.chatting = false;

    const config = vscode.workspace.getConfiguration('ollama-chat-rain');
    const serverUrl = config.get<string>('serverUrl') || 'http://localhost:11434';

    if (serverUrl === 'http://localhost:11434') {
        utils.executableIsAvailable("ollama");
    }

    context.subscriptions.push(vscode.window.registerWebviewViewProvider('OllamaChat.View', {
        resolveWebviewView(webviewView: vscode.WebviewView) {
            webview = webviewView.webview;
            webview.options = {
                enableScripts: true,
                localResourceRoots: [context.extensionUri]
            };
            webview.html = getWebViewHtmlContent(context, webview);
            
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
                    const contextNumber = getContextNumber(context);
                    if (messages.length > contextNumber) {
                        messages = messages.slice(messages.length - contextNumber);
                    }
                    messages.push({
                        role: "system",
                        content: utils.systemPromptContent
                    });
                    const refers: string[] = message.paths;
                    await initCurrentRecord(message.question, context);

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
                    await updateCurrentRecord({
                        role: 'user',
                        content: content
                    }, context);

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

                        await updateCurrentRecord({
                            role: 'assistant',
                            content: responseText
                        }, context);
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
                    let records = getOllamaChatRecord(context);
                    currentRecord = records.find(item => item.uguid === message.uguid);
                    postMessage({
                        command: "loadRecord",
                        records: records,
                        uguid: currentRecord ? currentRecord.uguid : ""
                    });
                } else if (message.command === "deleteRecord" && !globalThis.chatting) {
                    let records = getOllamaChatRecord(context);
                    records = records.filter(item =>item.uguid !== message.uguid);
                    await setOllamaChatRecord(context, records);
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
                    
                    const records = getOllamaChatRecord(context);
                    if (records.length > 0) {
                        currentRecord = records[records.length - 1];
                    }
                    postMessage({
                        command: "updateContextNumber",
                        text: getContextNumber(context).toString(),
                    });
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
                    updateCurrentInclude(context);
                } else if (message.command === "switchIncludeState") {
                    await setIncludeCurrent(context, !getIncludeCurrent(context));
                    updateCurrentInclude(context);
                } else if (message.command === "selectFile") {
                    vscode.workspace.openTextDocument(message.path).then(doc => {
                        vscode.window.showTextDocument(doc, {
                            preview: false,
                            viewColumn: vscode.ViewColumn.One
                        });
                    });
                } else if (message.command === "addInclude") {
                    addInclude();
                } else if (message.command === "setContextNumber") {
                    showSetContextNumber(context);
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

        let records = getOllamaChatRecord(context);
        postMessage({
            command: "loadRecord",
            records: records,
            uguid: ""
        });
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => updateCurrentInclude(context)));
    vscode.window.onDidChangeTextEditorSelection(() => updateCurrentInclude(context));
}

export function deactivate() { }
