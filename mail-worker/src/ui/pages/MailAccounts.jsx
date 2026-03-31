import React, { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ServerMigration from '../components/ServerMigration';
import { fetchWithRetry } from '../utils/api';

const MailAccounts = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('accounts');
  const [accounts, setAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchAccounts = async () => {
      setIsLoading(true);
      try {
        const data = await fetchWithRetry('/api/account/list');
        if (Array.isArray(data)) {
          setAccounts(data);
        } else {
          toast({
            title: '错误',
            description: '无法获取账户列表，请稍后再试。',
            variant: 'destructive',
          });
        }
      } catch (error) {
        toast({
          title: '错误',
          description: `获取账户列表失败: ${error.message}`,
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (activeTab === 'accounts') {
      fetchAccounts();
    }
  }, [activeTab, toast]);

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <h1 className="text-3xl font-bold mb-6">邮件账号</h1>

      <Tabs defaultValue="accounts" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="accounts">账户列表</TabsTrigger>
          <TabsTrigger value="smtp">SMTP 设置</TabsTrigger>
          <TabsTrigger value="migration">账户迁移</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>邮件账户</CardTitle>
              <CardDescription>管理您的邮件账户。</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-gray-500">加载中...</p>
              ) : accounts.length > 0 ? (
                <ul className="space-y-2">
                  {accounts.map((account) => (
                    <li key={account.id} className="p-2 border rounded-md">
                      {account.email}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500">暂无账户。</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="smtp" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>SMTP 设置</CardTitle>
              <CardDescription>配置和管理您的 SMTP 设置。</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-gray-500">这里可以添加 SMTP 设置的内容。</p>
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

export default MailAccounts;
