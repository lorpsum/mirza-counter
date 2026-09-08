export default async function handler(req, res) {
  return res.status(200).json({
    shop: !!process.env.SHOPIFY_SHOP,
    clientId: !!process.env.SHOPIFY_CLIENT_ID,
    clientSecret: !!process.env.SHOPIFY_CLIENT_SECRET
  });
}
