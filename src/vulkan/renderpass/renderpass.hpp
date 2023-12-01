#pragma once

#include "../device/device.hpp"
#include "../image/image.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieVulkan {
  class RenderPass {
    public:
      class Builder {
        public:
          Builder(Device* device, uint32_t width, uint32_t height, uint32_t layerNum = 1u);

          Builder& addSubpass(VkSubpassDescription subpass);
          Builder& addAttachment(VkAttachmentDescription attachment);
          Builder& addAttachments(std::vector<VkAttachmentDescription> attachment);
          Builder& addDependency(VkSubpassDependency dependency);
          Builder& addViewImages(std::vector<VkImageView> viewImages);

          RenderPass* build();

        private:
          Device* device;
          
          uint32_t width, height, layerNum;
          std::vector<VkSubpassDescription> subpasses;
          std::vector<VkAttachmentDescription> attachments;
          std::vector<VkSubpassDependency> dependencies;
          std::vector<std::vector<VkImageView>> viewImages;
      };

      RenderPass(Device* device, std::vector<std::vector<VkImageView>> viewImages, VkRenderPassCreateInfo renderPassInfo, uint32_t width, uint32_t height, uint32_t layerNum);
      ~RenderPass();

      VkFramebuffer getFramebuffers(int index) { return this->framebuffers[index]; }
      VkRenderPass getRenderPass() { return this->renderPass; }

    private:
      Device* device;

      std::vector<VkFramebuffer> framebuffers;
      VkRenderPass renderPass;

      void createRenderPass(VkRenderPassCreateInfo renderPassInfo);
      void createFramebuffers(std::vector<std::vector<VkImageView>> viewImages, uint32_t width, uint32_t height, uint32_t layerNum);
  };
} // namespace nugiEngin 


