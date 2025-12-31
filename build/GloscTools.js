import { chromium } from "playwright";
import { load } from "cheerio";
import fs from "fs/promises";
import path from "path";
import * as XLSX from "xlsx";
import * as pdfParse from "pdf-parse";
import mammoth from "mammoth";
import csv from "csv-parser";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import iconv from "iconv-lite";
export class GloscTools {
    /**
     * 使用浏览器或 fetch 获取网页内容
     * @param url 网页URL地址
     * @param useBrowser 是否模拟浏览器获取网页内容，true或false
     * @param type 内容类型, text、html或json
     * @returns
     */
    static async usebrowser(url, useBrowser = false, type = "text") {
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
    /**
     * 处理命令行指令，实时返回输出结果
     * @param command
     * @param args
     * @returns
     */
    static async spawnCommand(command, args, encoding = "utf8") {
        return new Promise((resolve, reject) => {
            const process = spawn(command, args, {
                stdio: ["pipe", "pipe", "pipe"],
            });
            let output = Buffer.alloc(0);
            process.stdout.on("data", (data) => {
                output = Buffer.concat([output, data]);
                console.log("Real-time output:", iconv.decode(data, encoding)); // 实时日志
            });
            process.stderr.on("data", (data) => {
                console.warn("Error output:", iconv.decode(data, encoding));
            });
            process.on("close", (code) => {
                if (code === 0) {
                    const decodedOutput = iconv.decode(output, encoding);
                    resolve({ code, output: decodedOutput });
                }
                else {
                    reject(new Error(`Process exited with code ${code}`));
                }
            });
            process.on("error", (error) => reject(error));
        });
    }
    /**
     * 解析 7-Zip l 命令的输出，返回文件列表数组
     * @param output 7-Zip 的输出字符串
     * @returns 文件列表
     */
    static parse7zOutput(output) {
        const lines = output.split("\n");
        const fileList = [];
        let inFileList = false;
        for (const line of lines) {
            if (line.includes("Date") &&
                line.includes("Time") &&
                line.includes("Attr")) {
                inFileList = true;
                continue;
            }
            if (inFileList &&
                line.trim() &&
                !line.includes("---") &&
                !line.includes("files")) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 6) {
                    const attr = parts[2];
                    const size = parseInt(parts[3]) || 0;
                    const name = parts.slice(5).join(" ");
                    const isDirectory = attr.includes("D") || attr.includes("d");
                    fileList.push({
                        name,
                        size,
                        isDirectory,
                    });
                }
            }
        }
        return fileList;
    }
    /**
     * 解析文件内容，支持多种文件类型
     * @param filePath  文件的绝对路径
     * @returns
     */
    static async processFile(filePath) {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const ext = path.extname(filePath).toLowerCase();
        const buffer = await fs.readFile(filePath);
        if ([
            ".txt",
            ".md",
            ".json",
            ".js",
            ".ts",
            ".html",
            ".css",
            ".xml",
            ".yaml",
            ".yml",
        ].includes(ext)) {
            // 文本文件
            return buffer.toString("utf-8");
        }
        else if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(ext)) {
            // 图片文件，返回base64编码
            const base64 = buffer.toString("base64");
            const mimeType = `image/${ext.slice(1)}`;
            return `data:${mimeType};base64,${base64}`;
        }
        else if (ext === ".csv") {
            // CSV文件，解析为JSON
            const results = [];
            const stream = require("stream");
            const readable = new stream.Readable();
            readable.push(buffer);
            readable.push(null);
            return new Promise((resolve, reject) => {
                readable
                    .pipe(csv())
                    .on("data", (data) => results.push(data))
                    .on("end", () => resolve(JSON.stringify(results, null, 2)))
                    .on("error", reject);
            });
        }
        else if ([".xlsx", ".xls"].includes(ext)) {
            // Excel文件，解析为JSON
            const workbook = XLSX.read(buffer, { type: "buffer" });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet);
            return JSON.stringify(json, null, 2);
        }
        else if (ext === ".pdf") {
            // PDF文件，提取文本
            const data = await pdfParse(buffer);
            return data.text;
        }
        else if (ext === ".docx") {
            // Word文档，提取文本
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        }
        else if ([
            ".zip",
            ".rar",
            ".7z",
            ".tar",
            ".gz",
            ".bz2",
            ".xz",
            ".tar.gz",
            ".tar.bz2",
        ].includes(ext)) {
            // 压缩包文件，使用7z列出内容
            const sevenZipPath = path.join(process.cwd(), "libs", "7z", "win", "7za.exe");
            const args = ["l", filePath];
            const res = await GloscTools.spawnCommand(sevenZipPath, args, "gbk");
            const fileList = GloscTools.parse7zOutput(res.output);
            return JSON.stringify(fileList);
        }
        else {
            // 其他文件，尝试作为文本读取
            try {
                return buffer.toString("utf-8");
            }
            catch {
                return `Unsupported file type: ${ext}`;
            }
        }
    }
}
