import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// BASE lets the same build serve from Vercel ("/") and from GitHub Pages ("/dhadkan/").
export default defineConfig({
  base: process.env.BASE ?? "/",
  plugins: [react(), tailwindcss()],
  build: { target: "es2022", sourcemap: true },
});
