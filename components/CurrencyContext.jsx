// context/CurrencyContext.jsx
import React, { createContext, useState, useContext } from 'react';

const CurrencyContext = createContext();

export const CurrencyProvider = ({ children }) => {
  const [currency, setCurrency] = useState('usd'); // Default currency
  const availableCurrencies = [
    'usd', 'eth', 'btc', 'eur', 'bnb', 'cny', 'gbp', 'hkd', 'idr', 'jpy',
    'krw', 'kwd', 'mmk', 'mxn', 'myr', 'ngn', 'nok', 'nzd', 'pln', 'rub',
    'sar', 'sek', 'sgd', 'sol', 'thb', 'try', 'twd', 'uah', 'vef', 'vnd',
    'xag', 'xau',
  ];

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, availableCurrencies }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);