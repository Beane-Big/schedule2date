# schedule2date

排期班表

这是一个 [Vibebooth](https://github.com/Beane-Big/vibebooth) 模块，由 `create-vibebooth` 生成。

## 常用命令

都在本目录运行，需要 Node.js。

### 发布：推荐交给平台的构建器打包

| 命令 | 需要 | 做什么 |
| --- | --- | --- |
| `npm run pack:source` | 只要 Node.js | 把源码打成 `dist/schedule2date-<版本>-source.zip`（不含 `node_modules`、`dist`），上传到平台的“构建器”页面，由服务器构建出软件包，构建完在构建记录上点“安装” |

推荐用这种方式：本机不用装 Docker，镜像在服务器上构建，用的是构建器设置里的镜像源。前提是平台上已经装好构建器。GitHub 上的 “Download ZIP” 也可以直接上传给构建器。

### 本机打包和开发（可选）

| 命令 | 需要 | 做什么 |
| --- | --- | --- |
| `npm run pack` | Docker | 在本机构建镜像，生成 `dist/schedule2date-<版本>.zip`，上传到平台的“应用管理”页。平台还没装构建器时用 |
| `npm run install:local` | Docker 和本机平台 | 打包并装到本机平台，打开 http://localhost:8080 就能看到。改完代码再运行一次即可 |
| `npm run dev` | Docker 和本机平台 | 只启动前端开发服务器，接口转给本机平台，改界面时不用每次打包。先在 http://localhost:8080 登录一次，再打开终端里显示的地址 |

- 运行前先启动 Docker（Windows 和 Mac 上是 Docker Desktop）。
- “本机平台”指在平台仓库里用 `docker compose up -d` 跑起来的 Vibebooth。`pack` 不需要本机平台。
- `pack` 用安装器镜像检查并打包：本机有平台时用本机平台的，没有时下载发布版 `ghcr.io/beane-big/vibebooth-installer`，第一次要能连上 ghcr.io。镜像还是私有的话，先用有 `read:packages` 权限的令牌运行一次 `docker login ghcr.io`。
- 本机平台比模块旧时，`pack` 会用旧的安装器而报错（比如不认识新字段），先在平台仓库里 `git pull` 再 `docker compose up -d --build`。

### 离开平台单独运行

| 命令 | 需要 | 做什么 |
| --- | --- | --- |
| `npm run standalone` | Node.js；有后端时还要 Go | 后端开独立模式（不校验令牌，所有请求都当成拥有全部权限的本地用户，数据放在 `.data/`），前端开发服务器把接口转给它。打开终端里显示的地址，按 Ctrl+C 一起退出 |

独立模式只用来在本机开发和演示，不要在 `compose.yaml` 里设 `STANDALONE`：装到平台里时 SDK 会拒绝所有请求。

### 升级到下一级

在本目录运行 `npx github:Beane-Big/create-vibebooth add <backend | data | permissions | persons>`，说明见 `AGENTS.md` 的“和平台耦合的等级”。

### 其他

| 命令 | 做什么 |
| --- | --- |
| `npm run rename -- <新 id> [新名称]` | 改模块 id，也可以同时改名称，代码、配置和文档里用到的地方一起改。只改名称就把 id 写成原来的。id 要在第一次装到平台前定好：装过的模块改 id 会变成另一个应用，旧数据不会跟过去 |

依赖在构建镜像时下载（Go 用 `GOPROXY`，npm 用 `NPM_REGISTRY`），本机不用装 Go。

发布新版本前，把 `module.yaml` 的 `version` 改大。
