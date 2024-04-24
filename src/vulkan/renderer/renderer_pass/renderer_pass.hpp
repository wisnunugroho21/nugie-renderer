#pragma once

#include "../../object/image/image.hpp"
#include "../../object/sampler/sampler.hpp"
#include "../../object/renderpass/renderpass.hpp"

#include <vulkan/vulkan.h>
#include <vector>
#include <memory>

namespace NugieApp {
  enum AttachmentType { KEEPED = 0, INPUT_OUTPUT = 1, OUTPUT_SHADER = 2, OUTPUT_TEXTURE = 3, OUTPUT_STORED = 4 };
  enum AttachmentRole { COLOR = 0, DEPTH = 1, RESOLVED = 2 };

  struct RendererPassAttachmentDesc {
    AttachmentRole attachmentRole;
    uint32_t subpassIndex;
    AttachmentType attachmentType;
    VkFormat format;
    VkSampleCountFlagBits sample;
    bool isOutside;
  };

  class RendererPass {
    public:
      class Builder {
        public:
          Builder(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, uint32_t layerNum = 1u);

          Builder& addAttachment(AttachmentType attachmentType, VkFormat format, VkImageLayout layout, VkSampleCountFlagBits sample);

          Builder& addAttachment(const std::vector<NugieVulkan::Image*> &attachments, AttachmentType attachmentType, VkFormat format, 
            VkImageLayout layout, VkSampleCountFlagBits sample);

          Builder& setDepthAttachment(AttachmentType attachmentType, VkFormat format, VkImageLayout layout, VkSampleCountFlagBits sample);

          Builder& setDepthAttachment(const std::vector<NugieVulkan::Image*> &attachments, AttachmentType attachmentType, VkFormat format, 
            VkImageLayout layout, VkSampleCountFlagBits sample);

          Builder& addResolvedAttachment(AttachmentType attachmentType, VkFormat format, VkImageLayout layout);

          Builder& addResolvedAttachment(const std::vector<NugieVulkan::Image*> &attachments, AttachmentType attachmentType, VkFormat format, 
            VkImageLayout layout);

          Builder& nextSubpass();

          RendererPass* build();

        private:
          NugieVulkan::Device* device = nullptr;
          uint32_t width, height, imageCount, layerNum;

          std::vector<RendererPassAttachmentDesc> subRendererAttachmentDescs;

          std::vector<std::vector<NugieVulkan::Image*>> attachments;
          std::vector<std::vector<NugieVulkan::Image*>> createdAttachments;

          std::vector<std::vector<NugieVulkan::Sampler*>> attachmentSamplers;
          std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> attachmentInfos;

          std::vector<VkAttachmentDescription> attachmentDescs;
          std::vector<std::vector<VkAttachmentReference>> outputAttachmentRefs;
          std::vector<VkAttachmentReference> depthAttachmentRefs;
          std::vector<std::vector<VkAttachmentReference>> inputAttachmentRefs;
          std::vector<std::vector<VkAttachmentReference>> resolveAttachmentRefs;
      };

      class Overwriter {
        public:
          Overwriter(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t imageCount, uint32_t layerNum = 1u);

          Overwriter& addOutsideAttachment(const std::vector<NugieVulkan::Image*> &attachments);
          void overwrite(RendererPass* subRenderer);

        private:
          NugieVulkan::Device* device = nullptr;
          uint32_t width, height, imageCount, layerNum;

          std::vector<std::vector<NugieVulkan::Image*>> outsideAttachments;
      };

      RendererPass(NugieVulkan::Device* device, uint32_t width, uint32_t height, uint32_t layerNum, const std::vector<std::vector<NugieVulkan::Image*>> &attachments, 
        const std::vector<std::vector<NugieVulkan::Image*>> &createdAttachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
        const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
        const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, const std::vector<std::vector<VkAttachmentReference>> &resolveAttachmentRefs,
        const std::vector<std::vector<NugieVulkan::Sampler*>> &attachmentSamplers, const std::vector<RendererPassAttachmentDesc> &subRendererAttachmentDescs,
        const std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> &attachmentInfos);
      ~RendererPass();
      
      NugieVulkan::RenderPass* getRenderPass() const { return this->renderPass; }
      std::vector<std::vector<VkDescriptorImageInfo>> getAttachmentInfos(uint32_t subpassIndex) const { return this->attachmentInfos[subpassIndex]; }

      virtual void beginRenderPass(NugieVulkan::CommandBuffer* commandBuffer, uint32_t imageIndex);
      virtual void nextSubpass(NugieVulkan::CommandBuffer* commandBuffer, VkSubpassContents subPassContent);
			virtual void endRenderPass(NugieVulkan::CommandBuffer* commandBuffer);

      void deleteCreatedAttachments();

      void recreateResources(uint32_t width, uint32_t height, uint32_t imageCount, const std::vector<std::vector<NugieVulkan::Image*>> &outsideAttachments);
      
    private:
      uint32_t width, height, layerNum;
      std::vector<VkClearValue> clearValues;

      std::vector<RendererPassAttachmentDesc> subRendererAttachmentDescs;
      std::vector<std::vector<NugieVulkan::Image*>> createdAttachments;
      
      std::vector<std::vector<NugieVulkan::Sampler*>> attachmentSamplers;
      std::vector<std::vector<std::vector<VkDescriptorImageInfo>>> attachmentInfos;

      NugieVulkan::Device* device = nullptr;
      NugieVulkan::RenderPass* renderPass = nullptr;

      void createRenderPass(const std::vector<std::vector<NugieVulkan::Image*>> &attachments, const std::vector<VkAttachmentDescription> &attachmentDescs, 
        const std::vector<std::vector<VkAttachmentReference>> &outputAttachmentRefs, const std::vector<VkAttachmentReference> &depthAttachmentRefs, 
        const std::vector<std::vector<VkAttachmentReference>> &inputAttachmentRefs, const std::vector<std::vector<VkAttachmentReference>> &resolveAttachmentRefs);
  };
  
} // namespace NugieApp
