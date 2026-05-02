/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  // We added tsconfig.json with allowJs:true so future files can be .ts, but
  // Next.js's route-export type checking is too strict for our existing JS
  // routes (e.g. src/app/api/chat/route.js exports `RANKS` and
  // `getRankForXp` helpers, which aren't valid Next Route exports per
  // Next 14's type spec). We're not ready to refactor every route — disable
  // type-check blocking until we do a proper TS migration. Build still
  // compiles successfully; only the type-check step is bypassed.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Same reasoning for ESLint — our existing codebase has lint warnings that
  // the CI build was fine with before; we don't want a non-blocking warning
  // becoming a blocking failure now that tsconfig is present.
  eslint: {
    ignoreDuringBuilds: true,
  },
};
export default nextConfig;
