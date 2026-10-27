import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 页面挂在 /apps/schedule2date/ 下；本地开发时把接口请求转给本机平台的网关（8080 端口），
// npm run standalone 时由 VB_API 指向独立运行的本机后端。
export default defineConfig({
  base: "/apps/schedule2date/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.VB_API ?? "http://localhost:8080",
    },
  },
});
