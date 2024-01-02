#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  enum AttachmentType { OUTPUT = 0, INPUT_OUTPUT = 1 };
  class SubRenderer {
    public:
      class Builder {
        public:
          Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, uint32_t layerNum = 1u);

          Builder& addAttachment(uint32_t subpassIndex, AttachmentType attachmentType, VkFormat format, VkImageLayout layout, 
            VkSampleCountFlagBits sample, VkAttachmentLoadOp loadOp, VkAttachmentStoreOp storeOp);

          Builder& setDepthAttachment(uint32_t subpassIndex, VkFormat format, VkImageLayout layout, 
            VkSampleCountFlagBits sample, VkAttachmentLoadOp loadOp, VkAttachmentStoreOp storeOp);

          Builder& setResolvedAttachment(std::vector<NugieVulkan::Image*> resolvedImages, VkFormat format, VkImageLayout layout, 
            VkSampleCountFlagBits sample, VkAttachmentLoadOp loadOp, VkAttachmentStoreOp storeOp);

          SubRenderer* build();

        private:
          NugieVulkan::Device* device;
          uint32_t width, height, imageCount, layerNum;

          std::vector<std::vector<NugieVulkan::Image*>> attachments;
          std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> attachmentInfos;

          std::vector<VkAttachmentDescription> attachmentDescs;
          std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs;
          std::vector<VkAttachmentReference> depthAttachmentRefs;
          std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs;
          VkAttachmentReference* resolveAttachmentRef;
      };

      SubRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum, const std::vector<std::vector<NugieVulkan::Image*>> &attachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
        const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, 
        VkAttachmentReference* resolveAttachmentRef, std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> attachmentInfos);
      ~SubRenderer();
      
      NugieVulkan::RenderPass* getRenderPass() const { return this->renderPass; }
      std::vector<std::vector<VkDescriptorImageInfo>> getAttachmentInfos(uint32_t subpassIndex) const { return this->attachmentInfos[subpassIndex]; }

      virtual void beginRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t imageIndex);
      virtual void nextSubpass(NugieVulkan::CommandBuffer* commandBuffer, VkSubpassContents subPassContent);
			virtual void endRenderPass(NugieVulkan::CommandBuffer* commandBuffer);

      void recreateResources(const std::vector<std::vector<VkImageView>> &attachments, uint32_t width, uint32_t height);
      
    private:
      uint32_t width, height, layerNum;

      std::vector<VkClearValue> clearValues;
      std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> attachmentInfos;

      NugieVulkan::Device* device;
      NugieVulkan::RenderPass* renderPass;

      void createRenderPass(const std::vector<std::vector<NugieVulkan::Image*>> &attachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
        const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
        const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, VkAttachmentReference* resolveAttachmentRef);
  };
  
} // namespace NugieApp
