# PocketMime

[English](README.md) · [21 秒宣传短片](docs/media/pocketmime-x.mp4) · [观看操作演示（MP4）](docs/media/pocketmime-demo.mp4)

给一个角色配上几句口头禅，做一套能在聊天里用的循环动图。角色可以用自己的 JPG 或 PNG、内置青蛙，也可以用本机的 Tessera 模型生成。一个项目保存 **1～15 个动态表情**。

<p>
  <img src="web/demo/on-it.gif" width="144" alt="On it">
  <img src="web/demo/noted.gif" width="144" alt="Noted">
  <img src="web/demo/clocking-out.gif" width="144" alt="Clocking out">
</p>

![PocketMime 首页的狐狸动图与四帧分镜](docs/media/home-zh.png)

## 本地启动

准备 **64 位 Python 3.12** 和现代浏览器，在项目目录中执行以下命令。启动后打开 **http://127.0.0.1:8765**，保持终端运行。按 Ctrl+C 停止服务。

**macOS**

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

**Windows（PowerShell）**

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

## 做一套表情包

1. 写下创意，可选上传 PNG 或 JPG。生成候选角色；想保留参考图的长相，也可以直接选择原图。
2. 确认一个角色后，进入默认六条表情描述。有 DeepSeek 密钥时按创意拟定，没有密钥时使用六条本地建议。
3. 在同一屏选择任一条，修改描述、配字、动作与速度，可增删至 1～15 条，也可点已完成的节点回看。此时只编辑方案。
4. 点击「生成整套动图」，系统复用确认的角色，按每条的动作和节奏输出循环 GIF。完成页可逐张预览、下载整套 ZIP，之后也能从历史项目重新下载或单张修改。

每个 GIF 由四个姿态组成。配置 Tessera 和 DeepSeek 后，DeepSeek 按最终描述编排起势、主要表现和收势，Tessera 在确认角色的局部重绘。仅有 Tessera 时使用本地动作分镜；没有 Tessera 时使用基础的局部形变生成预览和成品。

**「On it」的四个画面，按播放顺序排列。**

![On it — 逐帧分镜](web/demo/on-it-frames.png)

![单屏编辑表情方案](docs/media/workspace-zh.png)

## 设置和数据

- 在顶栏直接切换中文、English 以及日间、夜间模式。界面偏好保存在当前浏览器中。
- DeepSeek API Key 可在设置中输入，仅供本次服务进程使用；也可在启动前设置环境变量 `DEEPSEEK_API_KEY`。生成角色时，DeepSeek 将创意提炼为简短英文视觉描述，中文绘图提示也会先翻译再送入 Tessera。描述可用中文，GIF 配字统一使用英文和随项目附带的 Bangers 漫画字体。请求 AI 建议时，服务向 DeepSeek 发送创意文本、语言和数量。角色图和动图在本地处理。可用 `DEEPSEEK_MODEL` 覆盖默认模型 `deepseek-flash`。
- 项目、角色图、草稿与已确认的 GIF 保存在 `data/pocketmime.sqlite3`，停止服务后复制此文件即可备份。可用 `POCKETMIME_DATA` 指定其他目录。运行数据已排除在 Git 之外。下载文件的位置由浏览器设置决定。
- 配字默认使用项目内置的 Bangers 字体。如需其他字体，可用 `POCKETMIME_FONT` 指向本地字体文件。

## 可选：本地生成像素角色

在同一个虚拟环境中安装 `requirements-model.txt`。从[固定版本的 ONNX 模型仓库](https://huggingface.co/cfahlgren1/tessera-small-onnx/tree/bef21be58afea4d16be21f5fbe85eaa0cae69290)取出四个文件，放在同一目录：`tessera_w8.onnx`、`clip_text_w8.onnx`、`tokenizer.json`、`palette.json`。

默认读取项目旁的 `../models/tessera-small-onnx`。其他位置可用环境变量 `POCKETMIME_MODEL_DIR` 指定。在创建页填写简短英文角色描述，点击「生成候选角色」即可三选一。首次使用会从 Hugging Face 获取固定版本的 Python 采样器，校验 SHA-256 后缓存到 `data/model/`。此后使用本地 CPU 推理。上传角色、预设和手动编辑均可独立使用。

Tessera 的作者是 **Jagrat Patel（TheJagStudio）**，ONNX 转换和采样器来自 **cfahlgren1**。作者要求模型及其生成图像仅用于非商业用途，详见[模型许可说明](https://huggingface.co/thejagstudio/tessera-small#license)。权重独立存放，视频使用狐狸参考图、本地预设分镜与 Tessera 实际渲染。

## 宣传素材与检查

[无声 MP4 演示](docs/media/pocketmime-demo.mp4)为 1280 × 720、H.264 编码，展示创建、编辑、确认和下载流程，可以作为 X 帖子的视频附件。

使用虚拟环境的 Python 执行 `python -m unittest discover -s tests -v`，检查循环动图、项目数量限制、草稿和历史成品、ZIP 内容及 DeepSeek 请求处理。测试使用模拟 API 响应。
