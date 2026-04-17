const config = {
  experimental: { externalDir: true },
  env: {
    NEXT_PUBLIC_ADMIN_API_URL: process.env.ADMIN_API_URL,
  },
};
export default config;
