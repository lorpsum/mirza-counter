
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

    // 1. RÉCUPÉRER LE TOKEN SHOPIFY

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
        error: "Invalid Shopify token response",
        status: tokenResponse.status
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

    // 2. RÉCUPÉRER LES DATES DEMANDÉES
    // Format attendu : YYYY-MM-DD
    // Exemple : /api/orders?start=2026-09-01&end=2026-09-30

    const { start, end } = req.query || {};

    const isValidDate = (value) => {
      if (typeof value !== "string") return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

      const date = new Date(`${value}T00:00:00Z`);

      return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
    };

    if (!isValidDate(start) || !isValidDate(end)) {
      return res.status(400).json({
        error: "Please provide valid start and end dates",
        example: "/api/orders?start=2026-09-01&end=2026-09-30"
      });
    }

    if (start > end) {
      return res.status(400).json({
        error: "The start date must be before or equal to the end date"
      });
    }

    // 3. CONSTRUIRE LA PÉRIODE
    // Dates interprétées en heure de Paris.
    // La borne de fin est exclusive : on ajoute un jour à end.

    const startDate = new Date(`${start}T00:00:00+01:00`);
    const endDate = new Date(`${end}T00:00:00+01:00`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);

    const isoDate = (date) => date.toISOString();

    const startISO = isoDate(startDate);
    const endISO = isoDate(endDate);

    // 4. COMPTER LES COMMANDES SHOPIFY

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
            query OrdersCount($query: String!) {
              ordersCount(query: $query, limit: null) {
                count
                precision
              }
            }
          `,
          variables: {
            query: `created_at:>=${startISO} created_at:<${endISO}`
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
        error: "Invalid Shopify API response",
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

    const result = shopifyData?.data?.ordersCount;

    if (result?.count === undefined || result?.count === null) {
      return res.status(500).json({
        error: "Order count not found",
        details: shopifyData
      });
    }

    // 5. RENVOYER LE RÉSULTAT

    return res.status(200).json({
      count: Number(result.count),
      precision: result.precision,
      start,
      end,
      timezone: "Europe/Paris"
    });

  } catch (error) {
    console.error("Orders API error:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
