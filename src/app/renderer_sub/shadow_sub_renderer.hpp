#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  class ShadowSubRenderer {
    public:
      class Builder {
        public:
          Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, 
            uint32_t pointLightNum = 1u, uint32_t spotLightNum = 1u);

          Builder& addSubPass(std::vector<std::vector<VkImageView>> attachments, std::vector<VkAttachmentDescription> attachmentDescs, std::vector<VkAttachmentReference> outputAttachmentRefs, VkAttachmentReference depthAttachmentRefs, std::vector<VkAttachmentReference> inputAttachmentRefs = {});
          Builder& addResolveAttachmentRef(VkAttachmentReference resolveAttachmentRef);

          ShadowSubRenderer* build();

        private:
          NugieVulkan::Device* device;
          uint32_t width, height, pointLightNum, spotLightNum;

          std::vector<std::vector<VkImageView>> attachments;
          std::vector<VkAttachmentDescription> attachmentDescs;
          std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs;
          std::vector<VkAttachmentReference> depthAttachmentRefs;
          std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs;
          std::vector<VkAttachmentReference> resolveAttachmentRef;
      };

      ShadowSubRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t pointLightNum, uint32_t spotLightNum, std::vector<std::vector<VkImageView>> attachments, std::vector<VkAttachmentDescription> attachmentDescs, 
        std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs, std::vector<VkAttachmentReference> depthAttachmentRefs, std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs, 
        std::vector<VkAttachmentReference> resolveAttachmentRef);
      ~ShadowSubRenderer();
      
      NugieVulkan::RenderPass* getRenderPass() const { return this->renderPass; }

      void beginRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t currentFrameIndex, uint32_t lightIndex);
      void beginPointRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t currentFrameIndex, uint32_t pointLightIndex);
      void beginSpotRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t currentFrameIndex, uint32_t spotLightIndex);

      void nextSubpass(NugieVulkan::CommandBuffer* commandBuffer, VkSubpassContents subPassContent);
			void endRenderPass(NugieVulkan::CommandBuffer* commandBuffer);
      
    private:
      uint32_t width, height, pointLightNum, spotLightNum;
      std::vector<VkClearValue> clearValues;

      NugieVulkan::Device* device;
      NugieVulkan::RenderPass* renderPass;

      void createRenderPass(std::vector<std::vector<VkImageView>> attachments, std::vector<VkAttachmentDescription> attachmentDescs, 
        std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs, std::vector<VkAttachmentReference> depthAttachmentRefs, 
        std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs, std::vector<VkAttachmentReference> resolveAttachmentRef);
  };
  
} // namespace NugieApp
