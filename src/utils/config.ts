require('dotenv').config();

export const config = {
    database: process.env.DATABASE_URL,
    replicas: process.env.REPLICA_URLS || '[]'
}
