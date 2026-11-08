import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { PickleballHudScreen } from './src/screens/PickleballHudScreen';

export default function App(): React.JSX.Element {
  return (
    <>
      <StatusBar style="light" />
      <PickleballHudScreen />
    </>
  );
}

