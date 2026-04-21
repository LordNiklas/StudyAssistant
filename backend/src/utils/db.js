const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  return new Promise((resolve, reject) => {
    // Set a timeout to prevent hanging indefinitely
    const connectionTimeout = setTimeout(() => {
      reject(new Error('MongoDB connection timeout after 10 seconds'));
    }, 10000);

    mongoose.connect(process.env.MONGODB_URI)
      .then(connection => {
        clearTimeout(connectionTimeout);
        console.log('MongoDB connected successfully');
        resolve(connection);
      })
      .catch(error => {
        clearTimeout(connectionTimeout);
        console.error('MongoDB connection error:', error.message);
        reject(error);
      });
  });
};

module.exports = connectDB;