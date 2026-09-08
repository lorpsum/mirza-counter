export default async function handler(req, res) {
  try {
    const shop = "mrhis4-fn.myshopify.com";
    const token = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!token) {
      return res.status(500).json({
        error: "SHOPIFY_ACCESS_TOKEN is missing"
      });
    }

    const response = await fetch(
      `https://${shop}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token
        },
        body: JSON.stringify({
          query: `
            query {
              ordersCount {
                count
                precision
              }
            }
          `
        })
      }
    );

    const data = await response.json();

    if (!response.ok || data.errors) {
      return res.status(500).json({
        error: "Shopify API error",
        details: data.errors || data
      });
    }

    return res.status(200).json({
      count: data.data.ordersCount.count
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
