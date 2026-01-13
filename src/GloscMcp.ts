import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { GloscTools } from "./GloscTools.js";

export class GloscMcp {
    public server = new McpServer({
        name: "gloss-mod-manager",
        version: "1.62.1",
    });

    constructor() {
        this.registerTool();
        this.registerResource();
        this.registerPrompt();
    }

    /**
     * 注册工具
     */
    public registerTool() {
        this.server.registerTool(
            "time",
            {
                description: "获取当前时间",
                inputSchema: z.object({}),
            },
            async (input) => {
                return {
                    content: [
                        {
                            type: "text",
                            text: new Date().toISOString(),
                        },
                    ],
                };
            }
        );

        this.server.registerTool(
            "web",
            {
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
            },
            async ({ url, useBrowser, type }) => {
                // 获取网页内容
                const content = await GloscTools.usebrowser(
                    url,
                    useBrowser,
                    type
                );
                return {
                    content: [
                        {
                            type: "text",
                            text: content,
                        },
                    ],
                };
            }
        );

        this.server.registerTool(
            "readFile",
            {
                description:
                    "读取文件内容，支持多种文件类型：文本、图片、表格、文档、压缩包（ZIP、RAR、7Z、TAR、GZ等）",
                inputSchema: z.object({
                    path: z.string().describe("文件的绝对路径"),
                }),
            },
            async (input) => {
                const filePath = input.path;
                try {
                    const content = await GloscTools.processFile(filePath);
                    return {
                        content: [
                            {
                                type: "text",
                                text: content,
                            },
                        ],
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `读取文件失败: ${errorMessage}`,
                            },
                        ],
                    };
                }
            }
        );

        this.server.registerTool(
            "listApps",
            {
                description: "获取已安装应用列表（Windows 注册表）",
                inputSchema: z.object({
                    query: z.string().describe("按名称过滤（可选）").optional(),
                    matchMode: z
                        .enum(["contains", "equals", "regex"])
                        .describe("匹配模式")
                        .default("contains"),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .max(5000)
                        .describe("最多返回多少条")
                        .default(200),
                }),
            },
            async ({ query, matchMode, limit }) => {
                const apps = await GloscTools.listInstalledApps({
                    query,
                    matchMode,
                    limit,
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(apps, null, 2),
                        },
                    ],
                };
            }
        );

        this.server.registerTool(
            "getAppInstallPath",
            {
                description:
                    "获取应用安装路径（优先 InstallLocation，其次推断）",
                inputSchema: z.object({
                    name: z.string().describe("应用名称（支持模糊/正则）"),
                    matchMode: z
                        .enum(["contains", "equals", "regex"])
                        .describe("匹配模式")
                        .default("contains"),
                    allMatches: z
                        .boolean()
                        .describe("是否返回全部候选")
                        .default(false),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .max(500)
                        .describe("候选上限")
                        .default(50),
                }),
            },
            async ({ name, matchMode, allMatches, limit }) => {
                const result = await GloscTools.getAppInstallPath({
                    name,
                    matchMode,
                    allMatches,
                    limit,
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            }
        );

        this.server.registerTool(
            "openRef",
            {
                description:
                    "打开引用（文件/文件夹/URL/可执行文件），使用系统默认方式打开",
                inputSchema: z.object({
                    target: z.string().describe("要打开的目标：路径或 URL"),
                    args: z
                        .array(z.string())
                        .describe("当 target 是可执行文件时的参数")
                        .optional(),
                    wait: z
                        .boolean()
                        .describe("是否等待进程退出")
                        .default(false),
                }),
            },
            async ({ target, args, wait }) => {
                const res = await GloscTools.openReference({
                    target,
                    args,
                    wait,
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(res, null, 2),
                        },
                    ],
                };
            }
        );

        this.server.registerTool(
            "renameFile",
            {
                description: "重命名文件（同目录改名）",
                inputSchema: z.object({
                    path: z.string().describe("源文件的绝对路径"),
                    newName: z
                        .string()
                        .describe("新文件名（仅文件名，不含路径）"),
                    overwrite: z
                        .boolean()
                        .describe("目标已存在时是否覆盖")
                        .default(false),
                }),
            },
            async ({ path, newName, overwrite }) => {
                try {
                    const res = await GloscTools.renameFile({
                        path,
                        newName,
                        overwrite,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(res, null, 2),
                            },
                        ],
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `重命名失败: ${errorMessage}`,
                            },
                        ],
                    };
                }
            }
        );

        this.server.registerTool(
            "moveFile",
            {
                description: "移动文件到新路径（必要时自动创建目录）",
                inputSchema: z.object({
                    from: z.string().describe("源文件的绝对路径"),
                    to: z.string().describe("目标路径（文件路径或目录）"),
                    overwrite: z
                        .boolean()
                        .describe("目标已存在时是否覆盖")
                        .default(false),
                    createDirs: z
                        .boolean()
                        .describe("是否自动创建目标目录")
                        .default(true),
                }),
            },
            async ({ from, to, overwrite, createDirs }) => {
                try {
                    const res = await GloscTools.moveFile({
                        from,
                        to,
                        overwrite,
                        createDirs,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(res, null, 2),
                            },
                        ],
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `移动失败: ${errorMessage}`,
                            },
                        ],
                    };
                }
            }
        );

        this.server.registerTool(
            "listFilesRecursive",
            {
                description: "递归获取文件夹中的所有文件",
                inputSchema: z.object({
                    dir: z.string().describe("目录的绝对路径"),
                    limit: z
                        .number()
                        .int()
                        .min(1)
                        .max(20000)
                        .describe("最多返回多少条（防止输出过大）")
                        .default(5000),
                }),
            },
            async ({ dir, limit }) => {
                try {
                    const res = await GloscTools.listFilesRecursive({
                        dir,
                        limit,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(res, null, 2),
                            },
                        ],
                    };
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `列出文件失败: ${errorMessage}`,
                            },
                        ],
                    };
                }
            }
        );
    }
    /**
     * 注册资源
     */
    private registerResource() {}
    /**
     * 注册提示词
     */
    private registerPrompt() {}
}
