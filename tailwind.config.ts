import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        cave: "#090d12",
        panel: "#121820",
        gold: "#ffc44d",
        emerald: "#37e59b",
        diamond: "#77dcff"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Arial", "sans-serif"]
      },
      boxShadow: {
        gold: "0 0 28px rgba(255, 196, 77, 0.2)",
        emerald: "0 0 26px rgba(55, 229, 155, 0.18)"
      }
    }
  },
  plugins: []
};

export default config;
