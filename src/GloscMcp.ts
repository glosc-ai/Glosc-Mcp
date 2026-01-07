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
            "editText",
            {
                description:
                    "文本写入/编辑：支持按行添加/替换/删除（可批量），或创建/替换/删除整个文件",
                inputSchema: z
                    .object({
                        path: z.string().describe("文件的绝对路径"),
                        encoding: z
                            .string()
                            .describe("文本编码（默认 utf8）")
                            .default("utf8"),
                        newline: z
                            .enum(["auto", "lf", "crlf"])
                            .describe("换行符策略：auto/lf/crlf")
                            .default("auto"),
                        ensureFinalNewline: z
                            .boolean()
                            .describe("是否确保文件末尾以换行结尾")
                            .default(false),
                        returnContent: z
                            .boolean()
                            .describe("是否在结果中返回最终内容（可能很大）")
                            .default(false),
                        createIfMissing: z
                            .boolean()
                            .describe(
                                "按行 edits 时文件不存在是否自动新建（默认 false）"
                            )
                            .default(false),
                        file: z
                            .union([
                                z.object({
                                    action: z
                                        .literal("create")
                                        .describe("新建文件"),
                                    content: z.string().describe("文件内容"),
                                    overwrite: z
                                        .boolean()
                                        .describe("文件已存在时是否覆盖")
                                        .default(false),
                                }),
                                z.object({
                                    action: z
                                        .literal("replace")
                                        .describe("替换整个文件内容"),
                                    content: z.string().describe("文件内容"),
                                }),
                                z.object({
                                    action: z
                                        .literal("delete")
                                        .describe("删除文件"),
                                }),
                            ])
                            .optional(),
                        edits: z
                            .array(
                                z.union([
                                    z.object({
                                        op: z.literal("add"),
                                        at: z
                                            .number()
                                            .int()
                                            .min(1)
                                            .describe(
                                                "插入位置行号（1-based）；允许 lineCount+1 表示追加"
                                            ),
                                        position: z
                                            .enum(["before", "after"])
                                            .describe("插入到该行之前或之后")
                                            .default("before"),
                                        lines: z
                                            .array(z.string())
                                            .min(1)
                                            .describe(
                                                "要插入的行（不含换行符）"
                                            ),
                                    }),
                                    z.object({
                                        op: z.literal("replace"),
                                        start: z
                                            .number()
                                            .int()
                                            .min(1)
                                            .describe("起始行号（1-based）"),
                                        end: z
                                            .number()
                                            .int()
                                            .min(1)
                                            .optional()
                                            .describe(
                                                "结束行号（1-based，含）；缺省则等于 start"
                                            ),
                                        lines: z
                                            .array(z.string())
                                            .describe("替换后的行（可多行）"),
                                    }),
                                    z.object({
                                        op: z.literal("delete"),
                                        start: z
                                            .number()
                                            .int()
                                            .min(1)
                                            .describe("起始行号（1-based）"),
                                        end: z
                                            .number()
                                            .int()
                                            .min(1)
                                            .optional()
                                            .describe(
                                                "结束行号（1-based，含）；缺省则等于 start"
                                            ),
                                    }),
                                ])
                            )
                            .optional(),
                    })
                    .refine((v) => !!v.file !== !!v.edits, {
                        message: "必须且只能提供 file 或 edits 之一",
                    }),
            },
            async (input) => {
                try {
                    const res = await GloscTools.editTextFile({
                        path: input.path,
                        encoding: input.encoding,
                        newline: input.newline,
                        ensureFinalNewline: input.ensureFinalNewline,
                        returnContent: input.returnContent,
                        createIfMissing: input.createIfMissing,
                        file: input.file as any,
                        edits: input.edits as any,
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
                                text: `编辑文本失败: ${errorMessage}`,
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
