#  Glosc Mcp Tools

适用于 Glosc Copilot 的 Mcp 工具集。

### 配置
```json
{
  "servers": {
    "glosc": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "glosc-mcp@latest"
      ]
    }
  }
}
```
### Tools

- `listApps`
	- 入参：`{ query?: string, matchMode?: "contains"|"equals"|"regex", limit?: number }`

- `getAppInstallPath`
	- 获取应用安装路径（优先 `InstallLocation`，否则从 `DisplayIcon`/卸载命令推断）
	- 入参：`{ name: string, matchMode?: "contains"|"equals"|"regex", allMatches?: boolean, limit?: number }`
- `openRef`
	- 打开引用（文件/文件夹/URL/可执行文件），使用系统默认方式打开（Windows 下使用 `Start-Process`）
	- 入参：`{ target: string, args?: string[], wait?: boolean }`

- `readFile`
	- 读取文件内容，支持多种文件类型：文本、图片、表格、文档、压缩包（ZIP、RAR、7Z、TAR、GZ等）
	- 入参：`{ path: string }`
	- 说明：读取 Excel（.xlsx/.xls）时，若只有 1 张表则返回该表的行数组 JSON；若有多张表则返回 `{ sheets: [{ sheetName, rows }] }`。
- `editText`
  - 文本写入/编辑：按行添加/替换/删除（可批量），或创建/替换/删除整个文件
  - 入参（概要）：
    - 按行：`{ path, edits: [{ op: "add"|"replace"|"delete", ... }], createIfMissing?, encoding?, newline?, ensureFinalNewline?, returnContent? }`
- `renameFile`
  - 重命名文件（同目录改名）
  - 入参：`{ path: string, newName: string, overwrite?: boolean }`

- `moveFile`
  - 移动文件到新路径（必要时自动创建目录；目标为目录时会移动到该目录下）
  - 入参：`{ from: string, to: string, overwrite?: boolean, createDirs?: boolean }`

- `listFilesRecursive`
  - 递归获取文件夹中的所有文件（默认最多返回 5000 条，避免输出过大）
  - 入参：`{ dir: string, limit?: number }`
