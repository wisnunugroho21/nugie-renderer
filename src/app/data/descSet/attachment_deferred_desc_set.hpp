#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class AttachmentDeferredDescSet {
		public:
			AttachmentDeferredDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
				std::vector<VkDescriptorImageInfo> attachmentsInfo[5], uint32_t imageCount);
			~AttachmentDeferredDescSet();

			VkDescriptorSet getDescriptorSets(int imageIndex) const { return this->descriptorSets[imageIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

			void recreateDescriptorSet(std::vector<VkDescriptorImageInfo> attachmentsInfo[5]);

		private:
			NugieVulkan::Device* device;
			NugieVulkan::DescriptorPool* descriptorPool;
			uint32_t imageCount;
			
      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptorLayout();
			void createDescriptorSet(std::vector<VkDescriptorImageInfo> attachmentsInfo[5]);
	};
	
}