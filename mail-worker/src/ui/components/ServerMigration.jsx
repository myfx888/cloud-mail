import React, { useState, useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, RefreshCcw } from 'lucide-react';
import { fetchWithRetry } from '../utils/api';

const ServerMigration = () => {
  const { toast } = useToast();
  const [servers, setServers] = useState([]);
  const [sourceServerId, setSourceServerId] = useState('');
  const [targetServerId, setTargetServerId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState(null);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const settings = await fetchWithRetry('/api/setting/query');
        if (settings && settings.mailcowServers) {
          setServers(settings.mailcowServers);
          if (settings.mailcowServers.length >= 2) {
            setSourceServerId(settings.mailcowServers[0].id);
            setTargetServerId(settings.mailcowServers[1].id);
          }
        } else {
          toast({
            title: '错误',
            description: '无法获取服务器列表，请稍后再试。',
            variant: 'destructive',
          });
        }
      } catch (error) {
        toast({
          title: '错误',
          description: `获取服务器列表失败: ${error.message}`,
          variant: 'destructive',
        });
      }
    };

    fetchServers();
  }, [toast]);

  const handleMigrate = async () => {
    if (!sourceServerId || !targetServerId) {
      toast({
        title: '错误',
        description: '请选择源服务器和目标服务器。',
        variant: 'destructive',
      });
      return;
    }

    if (sourceServerId === targetServerId) {
      toast({
        title: '错误',
        description: '源服务器和目标服务器不能相同。',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    setMigrationStatus(null);

    try {
      const response = await fetchWithRetry(`/api/migrate-accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceServerId,
          targetServerId,
        }),
      });

      if (response.success) {
        setMigrationStatus({
          success: true,
          message: response.message,
        });
        toast({
          title: '成功',
          description: response.message,
          variant: 'success',
        });
      } else {
        setMigrationStatus({
          success: false,
          message: response.message || '迁移过程中发生错误。',
        });
        toast({
          title: '错误',
          description: response.message || '迁移过程中发生错误。',
          variant: 'destructive',
        });
      }
    } catch (error) {
      setMigrationStatus({
        success: false,
        message: `迁移失败: ${error.message}`,
      });
      toast({
        title: '错误',
        description: `迁移失败: ${error.message}`,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-6 bg-white rounded-lg shadow-md max-w-2xl mx-auto mt-6">
      <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
        <RefreshCcw className="w-6 h-6" />
        服务器账户迁移
      </h2>
      <p className="text-gray-600">将账户从一个 Mailcow 服务器迁移到另一个服务器。</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">源服务器</label>
          <Select value={sourceServerId} onValueChange={setSourceServerId} disabled={isLoading}>
            <SelectTrigger className="w-full rounded-md border-gray-300">
              <SelectValue placeholder="选择源服务器" />
            </SelectTrigger>
            <SelectContent>
              {servers.map((server) => (
                <SelectItem key={server.id} value={server.id}>{server.apiUrl}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">目标服务器</label>
          <Select value={targetServerId} onValueChange={setTargetServerId} disabled={isLoading}>
            <SelectTrigger className="w-full rounded-md border-gray-300">
              <SelectValue placeholder="选择目标服务器" />
            </SelectTrigger>
            <SelectContent>
              {servers.map((server) => (
                <SelectItem key={server.id} value={server.id}>{server.apiUrl}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button 
        onClick={handleMigrate} 
        disabled={isLoading || !sourceServerId || !targetServerId} 
        className="w-full mt-4"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            正在迁移中...
          </>
        ) : (
          "开始迁移"
        )}
      </Button>

      {migrationStatus && (
        <div className={`mt-4 p-4 rounded-md ${migrationStatus.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          <p className="font-medium">{migrationStatus.success ? '迁移成功' : '迁移失败'}</p>
          <p className="mt-1 text-sm">{migrationStatus.message}</p>
        </div>
      )}
    </div>
  );
};

export default ServerMigration;
