// --- pingme_shadowrocket.js ---
/**
 * PingMe 自动化签到+视频奖励 - Shadowrocket版本
 * 
 * [Script]
 * PingMe签到 = type=cron,cronexp="0 9 * * *",wake-system=1,timeout=60,script-path=pingme_shadowrocket.js
 * PingMe获取Token = type=http-request,pattern=^https:\/\/app\.medlinker\.com\/api\/v1\/user\/info,requires-body=0,max-size=0,script-path=pingme_shadowrocket.js
 * 
 * [MITM]
 * hostname = app.medlinker.com
 */

const SCRIPT_NAME = 'PingMe自动签到';
const STORAGE_KEY_TOKEN = 'pingme_token';
const STORAGE_KEY_USER = 'pingme_userinfo';

// API端点
const API = {
    userInfo: 'https://app.medlinker.com/api/v1/user/info',
    checkIn: 'https://app.medlinker.com/api/v1/checkin/do',
    videoReward: 'https://app.medlinker.com/api/v1/task/video/reward',
    taskList: 'https://app.medlinker.com/api/v1/task/list'
};

// Shadowrocket持久化封装
const Storage = {
    get(key) {
        return $persistentStore.read(key);
    },
    set(key, value) {
        return $persistentStore.write(value, key);
    },
    remove(key) {
        return $persistentStore.write(null, key);
    }
};

// HTTP请求封装
function httpRequest(options) {
    return new Promise((resolve, reject) => {
        $httpClient.post(options, (error, response, data) => {
            if (error) {
                reject(error);
            } else {
                resolve({
                    status: response.status,
                    headers: response.headers,
                    body: data
                });
            }
        });
    });
}

// 通知封装
function notify(title, subtitle, body) {
    $notification.post(title, subtitle, body);
}

// 获取Token（MITM抓取阶段）
function captureToken() {
    const headers = $request.headers;
    const token = headers['Authorization'] || headers['authorization'] || headers['token'] || headers['Token'];
    
    if (token) {
        Storage.set(STORAGE_KEY_TOKEN, token);
        
        // 同时获取用户信息
        httpRequest({
            url: API.userInfo,
            headers: {
                'Authorization': token,
                'User-Agent': 'PingMe/6.0.0 (iPhone; iOS 16.0; Scale/3.00)',
                'Content-Type': 'application/json'
            }
        }).then(resp => {
            try {
                const result = JSON.parse(resp.body);
                if (result.code === 0 && result.data) {
                    Storage.set(STORAGE_KEY_USER, JSON.stringify({
                        nickname: result.data.nickname || '用户',
                        userId: result.data.user_id || ''
                    }));
                    notify(SCRIPT_NAME, '✅ Token获取成功', `用户：${result.data.nickname}`);
                }
            } catch (e) {
                notify(SCRIPT_NAME, '⚠️ Token已保存', '用户信息解析失败');
            }
        }).catch(() => {
            notify(SCRIPT_NAME, '⚠️ Token已保存', '用户信息获取失败，但Token有效');
        });
        
        $done({});
    } else {
        notify(SCRIPT_NAME, '❌ 未检测到Token', '请确保抓包配置正确');
        $done({});
    }
}

// 执行签到
async function performCheckIn(token) {
    try {
        const response = await httpRequest({
            url: API.checkIn,
            headers: {
                'Authorization': token,
                'User-Agent': 'PingMe/6.0.0 (iPhone; iOS 16.0; Scale/3.00)',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        
        const result = JSON.parse(response.body);
        
        if (result.code === 0) {
            return {
                success: true,
                message: `签到成功！连续签到${result.data?.continuous_days || 0}天`,
                points: result.data?.reward_points || 0
            };
        } else if (result.code === 1001) {
            return {
                success: true,
                message: '今日已签到',
                alreadyChecked: true
            };
        } else {
            return {
                success: false,
                message: result.message || '签到失败'
            };
        }
    } catch (error) {
        return {
            success: false,
            message: `签到异常：${error.message || error}`
        };
    }
}

// 执行视频奖励任务
async function performVideoReward(token) {
    try {
        // 先获取任务列表确认视频任务状态
        const taskListResp = await httpRequest({
            url: API.taskList,
            headers: {
                'Authorization': token,
                'User-Agent': 'PingMe/6.0.0 (iPhone; iOS 16.0; Scale/3.00)',
                'Content-Type': 'application/json'
            }
        });
        
        const taskList = JSON.parse(taskListResp.body);
        let videoTaskAvailable = true;
        
        if (taskList.code === 0 && taskList.data) {
            const videoTask = taskList.data.find(t => t.task_type === 'video');
            if (videoTask && videoTask.completed >= videoTask.total) {
                return {
                    success: true,
                    message: '视频任务今日已完成',
                    alreadyCompleted: true
                };
            }
        }
        
        // 模拟观看视频并领取奖励（通常需要3-5次）
        let totalPoints = 0;
        let successCount = 0;
        const maxAttempts = 5;
        
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const response = await httpRequest({
                    url: API.videoReward,
                    headers: {
                        'Authorization': token,
                        'User-Agent': 'PingMe/6.0.0 (iPhone; iOS 16.0; Scale/3.00)',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        video_id: `video_${Date.now()}_${i}`,
                        watch_duration: 30 + Math.floor(Math.random() * 10)
                    })
                });
                
                const result = JSON.parse(response.body);
                
                if (result.code === 0) {
                    successCount++;
                    totalPoints += result.data?.reward_points || 10;
                } else if (result.code === 1002) {
                    // 今日次数已用完
                    break;
                } else {
                    break;
                }
                
                // 间隔2-4秒，模拟真实行为
                await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));
            } catch (e) {
                break;
            }
        }
        
        if (successCount > 0) {
            return {
                success: true,
                message: `视频奖励完成${successCount}次`,
                points: totalPoints
            };
        } else {
            return {
                success: false,
                message: '视频奖励任务失败或已达上限'
            };
        }
    } catch (error) {
        return {
            success: false,
            message: `视频任务异常：${error.message || error}`
        };
    }
}

// 主执行函数
async function main() {
    const token = Storage.get(STORAGE_KEY_TOKEN);
    
    if (!token) {
        notify(SCRIPT_NAME, '❌ 未找到Token', '请先打开PingMe App让脚本抓取Token');
        $done();
        return;
    }
    
    const userInfoStr = Storage.get(STORAGE_KEY_USER);
    let username = '用户';
    
    if (userInfoStr) {
        try {
            const userInfo = JSON.parse(userInfoStr);
            username = userInfo.nickname || '用户';
        } catch (e) {
            // 解析失败使用默认值
        }
    }
    
    notify(SCRIPT_NAME, '🚀 开始执行任务', `账号：${username}`);
    
    // 执行签到
    const checkInResult = await performCheckIn(token);
    let resultMessage = '';
    
    if (checkInResult.success) {
        if (checkInResult.alreadyChecked) {
            resultMessage += '✓ 今日已签到\n';
        } else {
            resultMessage += `✓ ${checkInResult.message}`;
            if (checkInResult.points > 0) {
                resultMessage += ` (+${checkInResult.points}积分)`;
            }
            resultMessage += '\n';
        }
    } else {
        resultMessage += `✗ 签到失败：${checkInResult.message}\n`;
    }
    
    // 执行视频奖励任务
    const videoResult = await performVideoReward(token);
    
    if (videoResult.success) {
        if (videoResult.alreadyCompleted) {
            resultMessage += '✓ 视频任务已完成';
        } else {
            resultMessage += `✓ ${videoResult.message}`;
            if (videoResult.points > 0) {
                resultMessage += ` (+${videoResult.points}积分)`;
            }
        }
    } else {
        resultMessage += `✗ 视频任务：${videoResult.message}`;
    }
    
    notify(SCRIPT_NAME, '✅ 任务执行完成', resultMessage);
    $done();
}

// 脚本入口判断
if (typeof $request !== 'undefined') {
    // HTTP请求阶段 - 抓取Token
    captureToken();
} else {
    // 定时任务阶段 - 执行签到
    main();
}
