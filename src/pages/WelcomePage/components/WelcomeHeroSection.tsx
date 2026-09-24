import { motion } from 'framer-motion';
import { MessageCircle, Users, ShieldCheck, Zap } from 'lucide-react';

export default function WelcomeHeroSection() {
  return (
    <section className="w-full py-16 md:py-28 bg-gradient-to-br from-primary/5 via-background to-accent/10">
      <div className="max-w-3xl mx-auto px-4 md:px-6 text-center">
        {/* 图标装饰 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="inline-flex items-center justify-center size-16 rounded-2xl bg-primary/10 text-primary mb-6"
        >
          <MessageCircle className="size-8" />
        </motion.div>

        {/* 标题 */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground"
        >
          欢迎来到
          <span className="text-primary"> 聊天室</span>
        </motion.h1>

        {/* 副标题 */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 text-lg md:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed"
        >
          输入房间号、密码与昵称，即可与好友开始端到端加密的实时对话。
        </motion.p>

        {/* 特性亮点 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <span>端到端加密</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-primary" />
            <span>实时消息推送</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            <span>多人同时在线</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
