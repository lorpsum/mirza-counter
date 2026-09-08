export default async function handler(req, res) {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shop || !accessToken) {
      return res.status(500).json({
        error: "Shopify credentials are missing"
      });
    }

    const response = await fetch(
      `https://${shop}.myshopify.com/admin/api/2026-07/graphql.json`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken
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
      console.error("SHOPIFY API ERROR:", data);

      return res.status(500).json({
        error: "Shopify API error",
        details: data.errors || data
      });
    }

    const count = data?.data?.ordersCount?.count;

    if (count === undefined || count === null) {
      return res.status(500).json({
        error: "Order count not found",
        details: data
      });
    }

    return res.status(200).json({
      count: Number(count)
    });

  } catch (error) {
    console.error("SERVER ERROR:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
