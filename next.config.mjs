/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // engine/worker code is run by tsx, not bundled by Next
  outputFileTracingExcludes: { '*': ['productions/**', 'tools/models/**', 'scratch/**'] },
  webpack: (config) => { config.watchOptions = { ...(config.watchOptions || {}), ignored: ['**/productions/**', '**/node_modules/**', '**/scratch/**', '**/episodes/**', '**/engine/dist/**'] }; return config; },
};
export default nextConfig;
