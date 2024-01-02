#pragma once

#include "../../vulkan/image/image.hpp"
#include "../../vulkan/sampler/sampler.hpp"
#include "../../vulkan/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  enum AttachmentType { KEEPED = 0, INPUT_OUTPUT = 1, OUTPUT_IMAGE = 2, OUTPUT_TEXTURE = 3 };
  class SubRenderer {
    public:
      class Builder {
        public:
          Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, uint32_t layerNum = 1u);

          Builder& addAttachment(uint32_t subpassIndex, AttachmentType attachmentType, VkFormat format, 
            VkImageLayout layout, VkSampleCountFlagBits sample);

          Builder& addAttachment(const std::vector<NugieVulkan::Image*> &attachments, uint32_t subpassIndex, 
            AttachmentType attachmentType, VkFormat format, VkImageLayout layout, VkSampleCountFlagBits sample);

          Builder& setDepthAttachment(uint32_t subpassIndex, AttachmentType attachmentType, VkFormat format, 
            VkImageLayout layout, VkSampleCountFlagBits sample);

          Builder& setResolvedAttachment(const std::vector<NugieVulkan::Image*> &attachments, VkFormat format, 
            VkImageLayout layout);

          SubRenderer* build();

        private:
          NugieVulkan::Device* device;
          uint32_t width, height, imageCount, layerNum;

          std::vector<std::vector<NugieVulkan::Image*>> attachments;
          std::vector<std::vector<NugieVulkan::Image*>> createdAttachments;

          std::vector<std::vector<NugieVulkan::Sampler*>> attachmentSamplers;
          std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> attachmentInfos;

          std::vector<VkAttachmentDescription> attachmentDescs;
          std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs;
          std::vector<VkAttachmentReference> depthAttachmentRefs;
          std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs;
          VkAttachmentReference* resolveAttachmentRef;
      };

      SubRenderer(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum, const std::vector<std::vector<NugieVulkan::Image*>> &attachments, 
        const std::vector<std::vector<NugieVulkan::Image*>> &createdAttachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
        const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
        const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, VkAttachmentReference* resolveAttachmentRef, 
        const std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> &attachmentInfos);
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

      std::vector<std::vector<NugieVulkan::Image*>> createdAttachments;
      std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> attachmentInfos;

      NugieVulkan::Device* device;
      NugieVulkan::RenderPass* renderPass;

      void createRenderPass(const std::vector<std::vector<NugieVulkan::Image*>> &attachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
        const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
        const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, VkAttachmentReference* resolveAttachmentRef);
  };
  
} // namespace NugieApp
