import React, { useEffect } from 'react';
import { AppState, StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EngineProvider } from './src/app/engine';
import { useLock } from './src/app/lock';
import type { RootStack } from './src/app/navigation';
import { TabsScreen } from './src/app/tabs';
import type { Deps } from './src/payments/engine';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { AddContactScreen } from './src/screens/AddContactScreen';
import { AmountScreen } from './src/screens/AmountScreen';
import { ConfirmScreen } from './src/screens/ConfirmScreen';
import { CreatePinScreen } from './src/screens/CreatePinScreen';
import { LimitsScreen } from './src/screens/LimitsScreen';
import { LockScreen } from './src/screens/LockScreen';
import { PaymentScreen } from './src/screens/PaymentScreen';
import { ReceiveScreen } from './src/screens/ReceiveScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { useApp } from './src/state/store';
import { colors } from './src/ui/theme';

const Stack = createNativeStackNavigator<RootStack>();

/**
 * Three worlds, chosen by state (React Navigation's pattern for sign in flows): first run, the
 * lock screen, and the app itself. Finishing setup or unlocking swaps the world; nothing
 * navigates into it, so Back can never leave the lock screen.
 */
export default function App({ deps }: { deps?: Deps }) {
  const onboarded = useApp(s => s.onboarded);
  const locked = useLock(s => s.locked);

  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'background') useLock.getState().hidden(Date.now());
      if (s === 'active') useLock.getState().shown(Date.now());
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <EngineProvider deps={deps}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
            {!onboarded ? (
              <Stack.Group>
                <Stack.Screen name="Welcome" component={WelcomeScreen} />
                <Stack.Screen name="Setup" component={SetupScreen} options={{ gestureEnabled: false }} />
                <Stack.Screen name="CreatePin" component={CreatePinScreen} options={{ gestureEnabled: false }} />
              </Stack.Group>
            ) : locked ? (
              <Stack.Screen name="Lock" component={LockScreen} options={{ animation: 'fade' }} />
            ) : (
              <Stack.Group>
                <Stack.Screen name="Tabs" component={TabsScreen} />
                <Stack.Screen name="Scan" component={ScanScreen} options={{ animation: 'slide_from_bottom' }} />
                <Stack.Screen name="Amount" component={AmountScreen} />
                <Stack.Screen name="Confirm" component={ConfirmScreen} options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
                <Stack.Screen name="Payment" component={PaymentScreen} options={{ gestureEnabled: false }} />
                <Stack.Screen name="Receive" component={ReceiveScreen} />
                <Stack.Screen name="AddContact" component={AddContactScreen} />
                <Stack.Screen name="Limits" component={LimitsScreen} />
                <Stack.Screen name="Activity" component={ActivityScreen} />
              </Stack.Group>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </EngineProvider>
    </SafeAreaProvider>
  );
}
