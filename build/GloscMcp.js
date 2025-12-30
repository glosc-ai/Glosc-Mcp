import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chromium } from "playwright";
import { load } from "cheerio";
import fs from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import * as pdfParse from "pdf-parse";
import mammoth from "mammoth";
import AdmZip from "adm-zip";
import csv from "csv-parser";
export class GloscMcp {
    server = new McpServer({
        name: "gloss-mod-manager",
        version: "1.62.1",
    });
    constructor() {
        this.registerTool();
        this.registerResource();
        this.registerPrompt();
    }
    async usebrowser(url, useBrowser = false, type = "text") {
        try {
            if (useBrowser) {
                // 使用浏览器模式
                const browser = await chromium.launch();
                const page = await browser.newPage();
                await page.goto(url, { waitUntil: "networkidle" });
                const html = await page.content();
                const $ = load(html);
                let content = "";
                if (type === "html") {
                }
                else if (type === "text") {
                    content = $.root().text();
                }
                else if (type === "json") {
                    const textContent = $.root().text();
                    try {
                        const jsonData = JSON.parse(textContent);
                        content = JSON.stringify(jsonData, null, 2);
                    }
                    catch {
                        content = textContent; // 解析失败， 直接返回文本内容
                    }
                }
                else {
                    content = html; // 默认 HTML
                }
                await browser.close();
                return content;
            }
            else {
                // 非浏览器模式，使用 fetch
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                if (type === "json") {
                    try {
                        const jsonData = await response.json();
                        return JSON.stringify(jsonData, null, 2);
                    }
                    catch (error) {
                        // 解析失败， 直接返回 text 内容
                        return await response.text();
                    }
                }
                else {
                    // 对于 "text" 和 "html"，都返回文本内容
                    return await response.text();
                }
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return `获取网页内容失败: ${errorMessage}`;
        }
    }
    async processFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const buffer = await fs.readFile(filePath);
        if (['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.xml', '.yaml', '.yml'].includes(ext)) {
            // 文本文件
            return buffer.toString('utf-8');
        }
        else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) {
            // 图片文件，返回base64编码
            const base64 = buffer.toString('base64');
            const mimeType = `image/${ext.slice(1)}`;
            return `data:${mimeType};base64,${base64}`;
        }
        else if (ext === '.csv') {
            // CSV文件，解析为JSON
            const results = [];
            const stream = require('stream');
            const readable = new stream.Readable();
            readable.push(buffer);
            readable.push(null);
            return new Promise((resolve, reject) => {
                readable.pipe(csv())
                    .on('data', (data) => results.push(data))
                    .on('end', () => resolve(JSON.stringify(results, null, 2)))
                    .on('error', reject);
            });
        }
        else if (['.xlsx', '.xls'].includes(ext)) {
            // Excel文件，解析为JSON
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet);
            return JSON.stringify(json, null, 2);
        }
        else if (ext === '.pdf') {
            // PDF文件，提取文本
            const data = await pdfParse(buffer);
            return data.text;
        }
        else if (ext === '.docx') {
            // Word文档，提取文本
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        }
        else if (ext === '.zip') {
            // ZIP文件，列出内容
            const zip = new AdmZip(buffer);
            const entries = zip.getEntries();
            const fileList = entries.map((entry) => ({
                name: entry.entryName,
                size: entry.header.size,
                isDirectory: entry.isDirectory
            }));
            return JSON.stringify(fileList, null, 2);
        }
        else {
            // 其他文件，尝试作为文本读取
            try {
                return buffer.toString('utf-8');
            }
            catch {
                return `Unsupported file type: ${ext}`;
            }
        }
    }
    /**
     * 注册工具
     */
    registerTool() {
        this.server.registerTool("time", {
            description: "获取当前时间",
            inputSchema: z.object({}),
        }, async (input) => {
            return {
                content: [
                    {
                        type: "text",
                        text: new Date().toISOString(),
                    },
                ],
            };
        });
        this.server.registerTool("web", {
            description: "提取网页内容",
            inputSchema: z.object({
                url: z.url().describe("网页URL地址"),
                useBrowser: z
                    .boolean()
                    .describe("是否模拟浏览器获取网页内容，true或false")
                    .default(false),
                type: z
                    .enum(["text", "html", "json"])
                    .describe("内容类型, text、html或json")
                    .default("text"),
            }),
        }, async ({ url, useBrowser, type }) => {
            // 获取网页内容
            const content = await this.usebrowser(url, useBrowser, type);
            return {
                content: [
                    {
                        type: "text",
                        text: content,
                    },
                ],
            };
        });
        this.server.registerTool("web-search", {
            description: "使用 Bing 联网搜索信息",
            inputSchema: z.object({
                query: z.string().describe("搜索查询内容"),
            }),
        }, async (input) => {
            const url = `https://cn.bing.com/search?q=${encodeURIComponent(input.query)}`;
            const content = await this.usebrowser(url, true, "text");
            return {
                content: [
                    {
                        type: "text",
                        text: content,
                    },
                ],
            };
        });
        this.server.registerTool("readFile", {
            description: "读取文件内容，支持多种文件类型：文本、图片、表格、文档、压缩包等",
            inputSchema: z.object({
                path: z.string().describe("文件的绝对路径"),
            }),
        }, async (input) => {
            const filePath = input.path;
            try {
                const content = await this.processFile(filePath);
                return {
                    content: [
                        {
                            type: "text",
                            text: content,
                        },
                    ],
                };
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [
                        {
                            type: "text",
                            text: `读取文件失败: ${errorMessage}`,
                        },
                    ],
                };
            }
        });
    }
    /**
     * 注册资源
     */
    registerResource() { }
    /**
     * 注册提示词
     */
    registerPrompt() { }
}
