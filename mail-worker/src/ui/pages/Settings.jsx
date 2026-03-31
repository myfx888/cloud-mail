import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ServerMigration from '../components/ServerMigration';

const Settings = () => {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <h1 className="text-3xl font-bold mb-6">设置</h1>

      <Tabs defaultValue="general" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="general">常规</TabsTrigger>
          <TabsTrigger value="servers">服务器</TabsTrigger>
          <TabsTrigger value="migration">账户迁移</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>常规设置</CardTitle>
              <CardDescription>管理您的常规设置和偏好。</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-gray-500">这里可以添加常规设置的内容。</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="servers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>服务器设置</CardTitle>
              <CardDescription>配置和管理您的 Mailcow 服务器。</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-gray-500">这里可以添加服务器设置的内容。</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="migration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>账户迁移</CardTitle>
              <CardDescription>将账户从一个服务器迁移到另一个服务器。</CardDescription>
            </CardHeader>
            <CardContent>
              <ServerMigration />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
