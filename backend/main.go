// 班表 的后端。网关已经校验过登录，这里用 SDK 拿到当前用户；数据存在本模块卷里的 SQLite 文件。
package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/Beane-Big/vibebooth/packages/sdk-go/auth"
)

const moduleID = "schedule2date"

// routes 收集其他文件注册的对内接口（班表接口在 schedule.go）。
var routes []func(api *http.ServeMux)

// store 是本模块的数据库，启动时打开，各接口共用。
var store *Store

func main() {
	var err error
	store, err = OpenStore(filepath.Join(env("DATA_DIR", "/data"), "schedule2date.db"))
	if err != nil {
		slog.Error("打开数据库失败", "err", err)
		os.Exit(1)
	}
	verifier := auth.NewVerifier(env("JWKS_URL", "http://core:8080/api/platform/.well-known/jwks.json"), moduleID)

	// 独立模式（npm run standalone）：离开平台单独运行时不校验令牌，当成一个拥有全部权限的本地用户。平台不会设这个变量。
	guard := verifier.Middleware
	if os.Getenv("STANDALONE") == "1" {
		slog.Warn("独立模式：不校验令牌，所有请求都是拥有全部权限的本地用户")
		guard = auth.Standalone("本地用户")
	}

	srv := &http.Server{Addr: ":8000", Handler: newHandler(guard), ReadHeaderTimeout: 10 * time.Second}
	slog.Info("schedule2date 模块已启动", "addr", srv.Addr)
	if err := srv.ListenAndServe(); err != nil {
		slog.Error("服务退出", "err", err)
		os.Exit(1)
	}
}

// newHandler 组装全部接口；guard 校验令牌、放入当前用户（测试里换成测试用的校验器）。
func newHandler(guard func(http.Handler) http.Handler) http.Handler {
	// 对内接口：只给本模块前端用，需要登录。
	api := http.NewServeMux()
	api.HandleFunc("GET /api/schedule2date/me", func(w http.ResponseWriter, r *http.Request) {
		user := auth.UserFrom(r.Context())
		writeJSON(w, http.StatusOK, map[string]any{"name": user.Name, "menus": user.Menus, "perms": user.Perms, "all": user.All})
	})

	for _, add := range routes {
		add(api)
	}

	mux := http.NewServeMux()
	// 健康检查由平台在内部网络直接调用，不经过网关，也不需要令牌。
	mux.HandleFunc("GET /api/schedule2date/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.Handle("/api/schedule2date/", guard(api))
	return mux
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
