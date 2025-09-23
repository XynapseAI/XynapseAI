"use client";

import React, { createContext, useState, useContext } from 'react';

const CurrencyContext = createContext();

export const CurrencyProvider = ({ children }) => {
  const [currency, setCurrency] = useState('usd'); // Default currency
  const availableCurrencies = [
  'usd', 
  'eur', 
  'jpy', 
  'gbp', 
  'cny', 
  'krw', 
  'inr', 
  'btc', 
  'eth', 
  'bnb',
  'sol',
  'usdt',
  'usdc'
];


  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, availableCurrencies }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);