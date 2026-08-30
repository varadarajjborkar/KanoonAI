/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfjs-dist ships a worker that must not be bundled for the server.
  serverExternalPackages: ['pdfjs-dist'],
  // Keep the repo to hand-written files only.
  agentRules: false,
};

export default nextConfig;
