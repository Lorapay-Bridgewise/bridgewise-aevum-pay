import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { Tabs } from './navigation';
import { ContactsScreen } from '../screens/ContactsScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { SafetyScreen } from '../screens/SafetyScreen';
import { Icon, type IconName } from '../ui/icons';
import { colors, fonts } from '../ui/theme';

const Tab = createBottomTabNavigator<Tabs>();

const icons: Record<keyof Tabs, IconName> = { Home: 'home', Contacts: 'contacts', Safety: 'shield' };

export function TabsScreen() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.green,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12 },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line, paddingTop: 6 },
        tabBarIcon: ({ color }) => <Icon name={icons[route.name]} color={color} />,
        sceneStyle: { backgroundColor: colors.bg },
      })}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Contacts" component={ContactsScreen} />
      <Tab.Screen name="Safety" component={SafetyScreen} />
    </Tab.Navigator>
  );
}
