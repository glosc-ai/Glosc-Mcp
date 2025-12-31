import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fileURLToPath } from "url";

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
            "web-search",
            {
                description: "使用 Bing 联网搜索信息",
                inputSchema: z.object({
                    query: z.string().describe("搜索查询内容"),
                }),
            },
            async (input) => {
                const url = `https://cn.bing.com/search?q=${encodeURIComponent(
                    input.query
                )}`;

                const content = await GloscTools.usebrowser(url, true, "text");

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
