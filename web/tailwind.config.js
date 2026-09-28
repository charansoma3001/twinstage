/** @type {import('tailwindcss').Config} */
export default {
  content: { relative: true, files: ["./index.html", "./settings.html", "./src/**/*.js"] },
  theme: {
    extend: {
      colors: {
        ember: { DEFAULT: "#FE5E0E", soft: "#FFE3D3" },
        sun: { DEFAULT: "#FEBE42", soft: "#FFF1D1" },
        ink: { DEFAULT: "#000B1A", 60: "#5B6270", 40: "#9AA0AA" },
        cream: "#F4F0EA"
      },
      fontFamily: {
        urbanist: ["Urbanist", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
