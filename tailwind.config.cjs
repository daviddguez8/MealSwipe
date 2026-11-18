const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: { extend: {
    colors: { bg: c("bg"), surface: c("surface"), ink: c("ink"), muted: c("muted"), line: c("line"), chip: c("chip"),
      accent: c("accent"), onaccent: c("onaccent"), good: c("good"), warn: c("warn"), danger: c("danger"), pass: c("pass") },
    fontFamily: { display: "var(--font-display)", body: "var(--font-body)" },
    boxShadow: { card: "0 18px 40px -18px rgb(var(--scrim) / .35), 0 2px 6px rgb(var(--scrim) / .08)" },
  } },
};
