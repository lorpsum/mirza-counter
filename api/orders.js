export default async function handler(req, res) {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

    if (!shop || !clientId || !clientSecret) {
      return res.status(500).json({
        error: "Shopify credentials are missing"
      });
    }

    // ==========================================
    // 1. GET ACCESS TOKEN
    // ==========================================

    const tokenResponse = await fetch(
      `https://${shop}.myshopify.com/admin/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret
        })
      }
    );

    const tokenText = await tokenResponse.text();

    let tokenData;

    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      return res.status(500).json({
        error: "Shopify returned an invalid token response",
        status: tokenResponse.status,
        details: tokenText.substring(0, 500)
      });
    }

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(500).json({
        error: "Shopify authentication failed",
        status: tokenResponse.status,
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;

    // ==========================================
    // 2. TODAY'S DATE
    // ==========================================

    const now = new Date();

    const parisDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);

    const startOfDay = `${parisDate}T00:00:00+02:00`;

    // ==========================================
    // 3. GET TODAY'S ORDERS + ITEMS SOLD
    // ==========================================

    const shopifyResponse = await fetch(
      `https://${shop}.myshopify.com/admin/api/2026-07/graphql.json`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Shopify-Access-Token": accessToken
        },

        body: JSON.stringify({
          query: `
            query Today'sOrders($query: String) {
              orders(first: 250, query: $query) {
                edges {
                  node {
                    lineItems(first: 250) {
                      edges {
                        node {
                          quantity
                        }
                      }
                    }
                  }
                }
              }

              ordersCount(query: $query) {
                count
                precision
              }
            }
          `,
          variables: {
            query: `created_at:>=${startOfDay}`
          }
        })
      }
    );

    const shopifyText = await shopifyResponse.text();

    let shopifyData;

    try {
      shopifyData = JSON.parse(shopifyText);
    } catch {
      return res.status(500).json({
        error: "Shopify API returned an invalid response",
        status: shopifyResponse.status,
        details: shopifyText.substring(0, 500)
      });
    }

    if (!shopifyResponse.ok || shopifyData.errors) {
      return res.status(500).json({
        error: "Shopify API error",
        status: shopifyResponse.status,
        details: shopifyData.errors || shopifyData
      });
    }

    // ==========================================
    // 4. TOTAL ORDERS
    // ==========================================

    const ordersCount =
      shopifyData?.data?.ordersCount?.count;

    if (
      ordersCount === undefined ||
      ordersCount === null
    ) {
      return res.status(500).json({
        error: "Order count not found"
      });
    }

    // ==========================================
    // 5. TOTAL ITEMS SOLD
    // ==========================================

    let itemsSold = 0;

    const orders =
      shopifyData?.data?.orders?.edges || [];

    for (const orderEdge of orders) {
      const lineItems =
        orderEdge?.node?.lineItems?.edges || [];

      for (const itemEdge of lineItems) {
        const quantity =
          Number(itemEdge?.node?.quantity || 0);

        itemsSold += quantity;
      }
    }

    // ==========================================
    // 6. RETURN RESULTS
    // ==========================================

    return res.status(200).json({
      orders: Number(ordersCount),
      items: itemsSold
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
