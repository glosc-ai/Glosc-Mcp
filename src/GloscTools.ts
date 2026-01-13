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
    public static escapePowerShellSingleQuoted(value: string): string {
        return `'${value.replace(/'/g, "''")}'`;
    }

    private static extractJsonFromOutput(output: string): string | null {
        const trimmed = output.trim();
        if (!trimmed) return null;

        const firstBrace = trimmed.indexOf("{");
        const firstBracket = trimmed.indexOf("[");
        const startCandidates = [firstBrace, firstBracket].filter(
            (n) => n >= 0
        );
        if (startCandidates.length === 0) return null;
        const start = Math.min(...startCandidates);

        const lastBrace = trimmed.lastIndexOf("}");
        const lastBracket = trimmed.lastIndexOf("]");
        const endCandidates = [lastBrace, lastBracket].filter((n) => n >= 0);
        if (endCandidates.length === 0) return null;
        const end = Math.max(...endCandidates);

        if (end <= start) return null;
        return trimmed.slice(start, end + 1);
    }

    public static async listInstalledApps(options?: {
        query?: string;
        matchMode?: "contains" | "equals" | "regex";
        limit?: number;
    }): Promise<
        Array<{
            name: string;
            version?: string;
            publisher?: string;
            installLocation?: string;
            installSource?: string;
            displayIcon?: string;
            uninstallString?: string;
            quietUninstallString?: string;
            registryKey?: string;
        }>
    > {
        if (process.platform !== "win32") {
            throw new Error("当前仅支持 Windows：通过注册表获取已安装应用列表");
        }

        const query = options?.query?.trim();
        const matchMode = options?.matchMode ?? "contains";
        const limit = options?.limit ?? 200;

        const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)

$apps = foreach ($p in $paths) {
  Get-ItemProperty -Path $p | Where-Object { $_.DisplayName -and $_.DisplayName.Trim().Length -gt 0 } | ForEach-Object {
    [PSCustomObject]@{
      Name = $_.DisplayName
      Version = $_.DisplayVersion
      Publisher = $_.Publisher
      InstallLocation = $_.InstallLocation
      InstallSource = $_.InstallSource
      DisplayIcon = $_.DisplayIcon
      UninstallString = $_.UninstallString
      QuietUninstallString = $_.QuietUninstallString
      RegistryKey = $_.PSPath
    }
  }
}

$apps = $apps | Sort-Object Name, Version, Publisher -Unique

if ($null -ne $apps) {
  $apps | ConvertTo-Json -Depth 4
}
`;

        const res = await GloscTools.spawnCommand(
            "powershell",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
            "utf8"
        );

        const jsonText = GloscTools.extractJsonFromOutput(res.output) ?? "[]";
        let apps: any[];
        try {
            const parsed = JSON.parse(jsonText);
            apps = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            throw new Error(
                `解析应用列表失败: ${
                    e instanceof Error ? e.message : String(e)
                }`
            );
        }

        const normalizedApps = apps
            .filter((a) => a && typeof a.Name === "string")
            .map((a) => ({
                name: String(a.Name),
                version: a.Version ? String(a.Version) : undefined,
                publisher: a.Publisher ? String(a.Publisher) : undefined,
                installLocation: a.InstallLocation
                    ? String(a.InstallLocation)
                    : undefined,
                installSource: a.InstallSource
                    ? String(a.InstallSource)
                    : undefined,
                displayIcon: a.DisplayIcon ? String(a.DisplayIcon) : undefined,
                uninstallString: a.UninstallString
                    ? String(a.UninstallString)
                    : undefined,
                quietUninstallString: a.QuietUninstallString
                    ? String(a.QuietUninstallString)
                    : undefined,
                registryKey: a.RegistryKey ? String(a.RegistryKey) : undefined,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const filtered = query
            ? GloscTools.filterApps(normalizedApps, query, matchMode)
            : normalizedApps;

        return filtered.slice(0, Math.max(1, limit));
    }

    private static filterApps<T extends { name: string }>(
        apps: T[],
        query: string,
        matchMode: "contains" | "equals" | "regex"
    ): T[] {
        const q = query.trim();
        if (!q) return apps;

        if (matchMode === "regex") {
            let re: RegExp;
            try {
                re = new RegExp(q, "i");
            } catch {
                return [];
            }
            return apps.filter((a) => re.test(a.name));
        }

        const nq = q.toLowerCase();
        const matches = apps.filter((a) => {
            const n = a.name.toLowerCase();
            if (matchMode === "equals") return n === nq;
            return n.includes(nq);
        });

        return matches.sort(
            (a, b) =>
                GloscTools.matchScore(a.name, q) -
                GloscTools.matchScore(b.name, q)
        );
    }

    private static matchScore(name: string, query: string): number {
        const n = name.toLowerCase();
        const q = query.toLowerCase();
        if (n === q) return 0;
        if (n.startsWith(q)) return 1;
        if (n.includes(q)) return 2;
        return 3;
    }

    public static inferInstallPathFromApp(app: {
        installLocation?: string;
        displayIcon?: string;
        uninstallString?: string;
        quietUninstallString?: string;
    }): {
        installPath?: string;
        source?: "InstallLocation" | "DisplayIcon" | "UninstallString";
        raw?: string;
    } {
        const loc = app.installLocation?.trim();
        if (loc) {
            return { installPath: loc, source: "InstallLocation", raw: loc };
        }

        const fromDisplayIcon = GloscTools.extractPathFromCommandLike(
            app.displayIcon
        );
        if (fromDisplayIcon) {
            const dir = path.dirname(fromDisplayIcon);
            return {
                installPath: dir,
                source: "DisplayIcon",
                raw: app.displayIcon,
            };
        }

        const fromUninstall = GloscTools.extractPathFromCommandLike(
            app.quietUninstallString ?? app.uninstallString
        );
        if (fromUninstall) {
            const dir = path.dirname(fromUninstall);
            return {
                installPath: dir,
                source: "UninstallString",
                raw: app.quietUninstallString ?? app.uninstallString,
            };
        }

        return {};
    }

    private static extractPathFromCommandLike(value?: string): string | null {
        if (!value) return null;
        let v = value.trim();
        if (!v) return null;

        // DisplayIcon 常见格式: "C:\\Path\\app.exe",0
        const commaIndex = v.indexOf(",");
        if (commaIndex > 0) v = v.slice(0, commaIndex);

        // 去掉外层引号
        if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
        ) {
            v = v.slice(1, -1);
        }

        // 若像命令行: "C:\\a b\\c.exe" /S
        const quotedMatch = v.match(/^"([^"]+)"/);
        if (quotedMatch?.[1]) return quotedMatch[1];

        const firstToken = v.split(/\s+/)[0];
        if (!firstToken) return null;
        return firstToken;
    }

    public static async getAppInstallPath(options: {
        name: string;
        matchMode?: "contains" | "equals" | "regex";
        allMatches?: boolean;
        limit?: number;
    }): Promise<{
        query: string;
        matchMode: "contains" | "equals" | "regex";
        result?: {
            name: string;
            installPath?: string;
            source?: string;
            version?: string;
            publisher?: string;
        };
        candidates: Array<{
            name: string;
            version?: string;
            publisher?: string;
            installLocation?: string;
            inferredInstallPath?: string;
            inferredSource?: string;
        }>;
    }> {
        const query = options.name;
        const matchMode = options.matchMode ?? "contains";
        const limit = options.limit ?? 50;

        const apps = await GloscTools.listInstalledApps({
            query,
            matchMode,
            limit,
        });

        const candidates = apps.map((a) => {
            const inferred = GloscTools.inferInstallPathFromApp({
                installLocation: a.installLocation,
                displayIcon: a.displayIcon,
                uninstallString: a.uninstallString,
                quietUninstallString: a.quietUninstallString,
            });
            return {
                name: a.name,
                version: a.version,
                publisher: a.publisher,
                installLocation: a.installLocation,
                inferredInstallPath: inferred.installPath,
                inferredSource: inferred.source,
            };
        });

        const best = candidates[0];
        return {
            query,
            matchMode,
            result:
                !options.allMatches && best
                    ? {
                          name: best.name,
                          installPath:
                              best.installLocation ?? best.inferredInstallPath,
                          source: best.installLocation
                              ? "InstallLocation"
                              : best.inferredSource,
                          version: best.version,
                          publisher: best.publisher,
                      }
                    : undefined,
            candidates: options.allMatches
                ? candidates
                : candidates.slice(0, 10),
        };
    }

    public static async openReference(options: {
        target: string;
        args?: string[];
        wait?: boolean;
    }): Promise<{ ok: true; target: string }> {
        const target = options.target?.trim();
        if (!target) throw new Error("target 不能为空");
        const wait = options.wait ?? false;
        const args = options.args ?? [];

        if (process.platform === "win32") {
            const filePath = GloscTools.escapePowerShellSingleQuoted(target);
            const argList =
                args.length > 0
                    ? ` -ArgumentList @(${args
                          .map((a) =>
                              GloscTools.escapePowerShellSingleQuoted(a)
                          )
                          .join(", ")})`
                    : "";
            const waitFlag = wait ? " -Wait" : "";
            const script = `Start-Process -FilePath ${filePath}${argList}${waitFlag}`;

            await GloscTools.spawnCommand(
                "powershell",
                [
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    script,
                ],
                "utf8"
            );

            return { ok: true, target };
        }

        if (process.platform === "darwin") {
            await GloscTools.spawnCommand("open", [target], "utf8");
            return { ok: true, target };
        }

        // linux / other
        await GloscTools.spawnCommand("xdg-open", [target], "utf8");
        return { ok: true, target };
    }
    /**
     * 使用浏览器或 fetch 获取网页内容
     * @param url 网页URL地址
     * @param useBrowser 是否模拟浏览器获取网页内容，true或false
     * @param type 内容类型, text、html或json
     * @returns
     */
    public static async usebrowser(
        url: string,
        useBrowser: boolean = false,
        type: "text" | "html" | "json" = "text"
    ) {
        try {
            if (useBrowser) {
                // 使用浏览器模式
                const browser = await chromium.launch();
                const page = await browser.newPage();
                await page.goto(url, { waitUntil: "networkidle" });

                const html = await page.content();
                const $ = load(html);

                let content: string = "";
                if (type === "html") {
                } else if (type === "text") {
                    content = $.root().text();
                } else if (type === "json") {
                    const textContent = $.root().text();
                    try {
                        const jsonData = JSON.parse(textContent);
                        content = JSON.stringify(jsonData, null, 2);
                    } catch {
                        content = textContent; // 解析失败， 直接返回文本内容
                    }
                } else {
                    content = html; // 默认 HTML
                }

                await browser.close();
                return content;
            } else {
                // 非浏览器模式，使用 fetch
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(
                        `HTTP ${response.status}: ${response.statusText}`
                    );
                }

                if (type === "json") {
                    try {
                        const jsonData = await response.json();
                        return JSON.stringify(jsonData, null, 2);
                    } catch (error) {
                        // 解析失败， 直接返回 text 内容
                        return await response.text();
                    }
                } else {
                    // 对于 "text" 和 "html"，都返回文本内容
                    return await response.text();
                }
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return `获取网页内容失败: ${errorMessage}`;
        }
    }

    /**
     * 处理命令行指令，实时返回输出结果
     * @param command
     * @param args
     * @returns
     */
    public static async spawnCommand(
        command: string,
        args: string[],
        encoding: string = "utf8"
    ): Promise<{ code: number; output: string }> {
        return new Promise((resolve, reject) => {
            const process = spawn(command, args, {
                stdio: ["pipe", "pipe", "pipe"],
            });
            let output = Buffer.alloc(0);

            process.stdout.on("data", (data: Buffer) => {
                output = Buffer.concat([output, data]);
                console.log(
                    "Real-time output:",
                    (iconv as any).decode(data, encoding)
                ); // 实时日志
            });

            process.stderr.on("data", (data: Buffer) => {
                console.warn(
                    "Error output:",
                    (iconv as any).decode(data, encoding)
                );
            });

            process.on("close", (code) => {
                if (code === 0) {
                    const decodedOutput = (iconv as any).decode(
                        output,
                        encoding
                    );
                    resolve({ code, output: decodedOutput });
                } else {
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
    public static parse7zOutput(output: string) {
        const lines = output.split("\n");
        const fileList: { name: string; size: number; isDirectory: boolean }[] =
            [];
        let inFileList = false;

        for (const line of lines) {
            if (
                line.includes("Date") &&
                line.includes("Time") &&
                line.includes("Attr")
            ) {
                inFileList = true;
                continue;
            }
            if (
                inFileList &&
                line.trim() &&
                !line.includes("---") &&
                !line.includes("files")
            ) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 6) {
                    const attr = parts[2];
                    const size = parseInt(parts[3]) || 0;
                    const name = parts.slice(5).join(" ");
                    const isDirectory =
                        attr.includes("D") || attr.includes("d");
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
    public static async processFile(filePath: string): Promise<string> {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const ext = path.extname(filePath).toLowerCase();
        const buffer = await fs.readFile(filePath);

        if (
            [
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
            ].includes(ext)
        ) {
            // 文本文件
            return buffer.toString("utf-8");
        } else if (
            [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(ext)
        ) {
            // 图片文件，返回base64编码
            const base64 = buffer.toString("base64");
            const mimeType = `image/${ext.slice(1)}`;
            return `data:${mimeType};base64,${base64}`;
        } else if (ext === ".csv") {
            // CSV文件，解析为JSON
            const results: any[] = [];
            const stream = require("stream");
            const readable = new stream.Readable();
            readable.push(buffer);
            readable.push(null);
            return new Promise((resolve, reject) => {
                readable
                    .pipe(csv())
                    .on("data", (data: any) => results.push(data))
                    .on("end", () => resolve(JSON.stringify(results, null, 2)))
                    .on("error", reject);
            });
        } else if ([".xlsx", ".xls"].includes(ext)) {
            // Excel文件，解析为JSON
            const workbook = XLSX.read(buffer, { type: "buffer" });
            const sheetNames = (workbook.SheetNames ?? []).filter(
                (name) => typeof name === "string" && name.trim().length > 0
            );

            if (sheetNames.length === 0) {
                return JSON.stringify([], null, 2);
            }

            const sheets = sheetNames.map((sheetName) => {
                const worksheet = workbook.Sheets[sheetName];
                const rows = worksheet
                    ? XLSX.utils.sheet_to_json(worksheet, {
                          defval: null,
                      })
                    : [];

                return {
                    sheetName,
                    rows,
                };
            });

            // 兼容：只有 1 张表时保持旧行为（直接返回行数组）
            if (sheets.length === 1) {
                return JSON.stringify(sheets[0].rows, null, 2);
            }

            // 多张表：返回按 sheet 分组的结构，避免数据混淆
            return JSON.stringify({ sheets }, null, 2);
        } else if (ext === ".pdf") {
            // PDF文件，提取文本
            const data = await (pdfParse as any)(buffer);
            return data.text;
        } else if (ext === ".docx") {
            // Word文档，提取文本
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        } else if (
            [
                ".zip",
                ".rar",
                ".7z",
                ".tar",
                ".gz",
                ".bz2",
                ".xz",
                ".tar.gz",
                ".tar.bz2",
            ].includes(ext)
        ) {
            // 压缩包文件，使用7z列出内容
            const sevenZipPath = path.join(
                process.cwd(),
                "libs",
                "7z",
                "win",
                "7za.exe"
            );
            const args = ["l", filePath];

            const res = await GloscTools.spawnCommand(
                sevenZipPath,
                args,
                "gbk"
            );
            const fileList = GloscTools.parse7zOutput(res.output);
            return JSON.stringify(fileList);
        } else {
            // 其他文件，尝试作为文本读取
            try {
                return buffer.toString("utf-8");
            } catch {
                return `Unsupported file type: ${ext}`;
            }
        }
    }

    private static normalizeNewlineOption(
        newline: "auto" | "lf" | "crlf" | undefined,
        existingContent: string | undefined
    ): string {
        if (newline === "crlf") return "\r\n";
        if (newline === "lf") return "\n";
        // auto
        if (
            typeof existingContent === "string" &&
            existingContent.includes("\r\n")
        ) {
            return "\r\n";
        }
        return "\n";
    }

    private static splitLinesPreserveEmptyEnd(text: string): string[] {
        // 支持 \n / \r\n，且保留末尾空行（比如文件以换行结尾）
        if (text === "") return [""];
        return text.split(/\r?\n/);
    }

    private static joinLines(lines: string[], newline: string): string {
        return lines.join(newline);
    }

    private static async pathExists(p: string): Promise<boolean> {
        try {
            await fs.stat(p);
            return true;
        } catch (e: any) {
            if (e && (e.code === "ENOENT" || e.code === "ENOTDIR"))
                return false;
            throw e;
        }
    }

    private static async removePath(targetPath: string): Promise<void> {
        const st = await fs.lstat(targetPath);
        if (st.isDirectory()) {
            await fs.rm(targetPath, { recursive: true, force: true });
        } else {
            await fs.unlink(targetPath);
        }
    }

    private static async movePathInternal(options: {
        from: string;
        to: string;
        overwrite?: boolean;
        createDirs?: boolean;
    }): Promise<{ ok: true; from: string; to: string }> {
        const from = options.from?.trim();
        const to = options.to?.trim();
        if (!from) throw new Error("from 不能为空");
        if (!to) throw new Error("to 不能为空");

        const overwrite = options.overwrite ?? false;
        const createDirs = options.createDirs ?? true;

        const fromStat = await fs.lstat(from).catch((e: any) => {
            if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) {
                throw new Error("源路径不存在");
            }
            throw e;
        });

        let dest = to;
        const toLooksLikeDir = /[\\/]+$/.test(to);
        if (toLooksLikeDir) {
            dest = path.join(to, path.basename(from));
        } else {
            try {
                const toStat = await fs.lstat(to);
                if (toStat.isDirectory()) {
                    dest = path.join(to, path.basename(from));
                }
            } catch (e: any) {
                if (!(e && (e.code === "ENOENT" || e.code === "ENOTDIR"))) {
                    throw e;
                }
            }
        }

        if (await GloscTools.pathExists(dest)) {
            if (!overwrite) {
                throw new Error("目标已存在；如需覆盖请设置 overwrite=true");
            }
            await GloscTools.removePath(dest);
        }

        if (createDirs) {
            await fs.mkdir(path.dirname(dest), { recursive: true });
        }

        try {
            await fs.rename(from, dest);
            return { ok: true, from, to: dest };
        } catch (e: any) {
            // 跨盘符/设备移动在部分平台会抛 EXDEV
            if (e && e.code === "EXDEV") {
                if (fromStat.isDirectory()) {
                    const cp = (fs as any).cp as
                        | undefined
                        | ((
                              src: string,
                              dest: string,
                              opts: any
                          ) => Promise<void>);
                    if (!cp) {
                        throw new Error(
                            "跨设备移动目录失败（EXDEV），且当前 Node 版本不支持 fs.cp"
                        );
                    }
                    await cp(from, dest, { recursive: true, force: overwrite });
                    await fs.rm(from, { recursive: true, force: true });
                    return { ok: true, from, to: dest };
                }

                await fs.copyFile(from, dest);
                await fs.unlink(from);
                return { ok: true, from, to: dest };
            }
            throw e;
        }
    }

    public static async renameFile(options: {
        path: string;
        newName: string;
        overwrite?: boolean;
    }): Promise<{ ok: true; from: string; to: string }> {
        const from = options.path?.trim();
        const newName = options.newName?.trim();
        if (!from) throw new Error("path 不能为空");
        if (!newName) throw new Error("newName 不能为空");

        // 限制为“同目录改名”，避免把 rename 当 move 用
        const base = path.basename(newName);
        if (base !== newName) {
            throw new Error("newName 只能是文件名，不能包含路径分隔符");
        }
        const to = path.join(path.dirname(from), newName);

        return GloscTools.movePathInternal({
            from,
            to,
            overwrite: options.overwrite,
            createDirs: true,
        });
    }

    public static async moveFile(options: {
        from: string;
        to: string;
        overwrite?: boolean;
        createDirs?: boolean;
    }): Promise<{ ok: true; from: string; to: string }> {
        return GloscTools.movePathInternal(options);
    }

    public static async listFilesRecursive(options: {
        dir: string;
        limit?: number;
    }): Promise<{
        ok: true;
        dir: string;
        files: string[];
        truncated: boolean;
    }> {
        const dir = options.dir?.trim();
        if (!dir) throw new Error("dir 不能为空");
        const limit = Math.max(1, Math.trunc(options.limit ?? 5000));

        const rootStat = await fs.lstat(dir).catch((e: any) => {
            if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) {
                throw new Error("目录不存在");
            }
            throw e;
        });
        if (!rootStat.isDirectory()) {
            throw new Error("dir 必须是目录");
        }

        const files: string[] = [];
        const stack: string[] = [dir];
        let truncated = false;

        while (stack.length > 0) {
            const current = stack.pop() as string;
            const entries = await fs.readdir(current, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(full);
                } else if (entry.isFile()) {
                    files.push(full);
                    if (files.length >= limit) {
                        truncated = true;
                        stack.length = 0;
                        break;
                    }
                }
            }
        }

        return { ok: true, dir, files, truncated };
    }
}
