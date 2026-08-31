import { db } from './db';

const getApiUrl = () => typeof window !== 'undefined' ? `http://${window.location.hostname}:3001/api` : 'http://127.0.0.1:3001/api';

export async function syncOfflineOrders() {
  const orders = await db.offlineOrders.toArray();
  if (orders.length === 0) return;

  console.log(`Attempting to sync ${orders.length} offline orders...`);
  
  for (const order of orders) {
    try {
      const res = await fetch(`${getApiUrl()}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order.payload)
      });
      
      if (res.ok) {
        await db.offlineOrders.delete(order.id);
        console.log(`Synced order ${order.id}`);
      }
    } catch (e) {
      console.error(`Failed to sync order ${order.id}, will retry later.`);
      break; // Stop if network is down
    }
  }
}
